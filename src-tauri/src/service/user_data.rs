use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::fs;
use tokio::time::{timeout, Duration};

pub struct UserData {
    root_dir: PathBuf,
}

impl UserData {
    pub fn new(app: &tauri::AppHandle, root: &str) -> Self {
        let base = app
            .path()
            .app_data_dir()
            .expect("Failed to resolve app data dir");

        Self {
            root_dir: if root.is_empty() {
                base
            } else {
                base.join(root)
            },
        }
    }

    fn ensure_ext(file_name: &str, ext: &str) -> String {
        let path = Path::new(file_name);
        if path.extension().is_some() {
            file_name.to_string()
        } else {
            format!("{}{}", file_name, ext)
        }
    }

    fn resolve_path(&self, file_name: &str) -> PathBuf {
        self.root_dir.join(Self::ensure_ext(file_name, ".json"))
    }

    pub async fn read<T>(&self, file_name: &str, timeout_ms: Option<u64>) -> Option<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let file_path = self.resolve_path(file_name);
        let read_fut = self.read_inner::<T>(file_name, &file_path);

        match timeout_ms {
            Some(ms) if ms > 0 => {
                match timeout(Duration::from_millis(ms), read_fut).await {
                    Ok(result) => result,
                    Err(_) => {
                        eprintln!("[UserData] read timed out for \"{}\"", file_name);
                        None
                    }
                }
            }
            _ => read_fut.await,
        }
    }

    async fn read_inner<T>(&self, file_name: &str, file_path: &PathBuf) -> Option<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let raw = match fs::read_to_string(file_path).await {
            Ok(content) => content,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("[UserData] read failed for \"{}\": {}", file_name, e);
                }
                return None;
            }
        };

        match serde_json::from_str::<T>(&raw) {
            Ok(value) => Some(value),
            Err(parse_err) => {
                eprintln!(
                    "[UserData] JSON parse failed for \"{}\", renaming to .corrupted: {}",
                    file_name, parse_err
                );
                let corrupted = file_path.with_extension("json.corrupted");
                if fs::rename(file_path, &corrupted).await.is_err() {
                    let _ = fs::remove_file(file_path).await;
                }
                None
            }
        }
    }

    pub async fn write<T>(&self, file_name: &str, value: &T) -> Result<(), anyhow::Error>
    where
        T: Serialize,
    {
        let file_path = self.resolve_path(file_name);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let json = serde_json::to_string_pretty(value)?;
        fs::write(&file_path, json.as_bytes()).await?;

        println!("Write to {}", file_path.display());
        Ok(())
    }

    pub async fn delete(&self, file_name: &str) -> Result<(), anyhow::Error> {
        let file_path = self.resolve_path(file_name);

        match fs::remove_file(&file_path).await {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn read_raw(&self, file_name: &str, timeout_ms: Option<u64>) -> Option<Value> {
        self.read::<Value>(file_name, timeout_ms).await
    }
}