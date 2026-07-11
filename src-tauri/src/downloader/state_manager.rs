use crate::downloader::error::Result;
use crate::downloader::types::{ChunkState, DownloadState};
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

pub struct StateManager {
    state_dir: PathBuf,
    lock: Mutex<()>,
}

pub struct SaveResult {
    pub last_checkpoint: i64,
    pub last_write_time_ms: i64,
}

impl StateManager {
    pub async fn new(state_dir: impl Into<PathBuf>) -> Result<Self> {
        let state_dir = state_dir.into();
        tokio::fs::create_dir_all(&state_dir).await?;
        Ok(Self {
            state_dir,
            lock: Mutex::new(()),
        })
    }

    fn state_path(&self, id: &str) -> PathBuf {
        self.state_dir.join(format!("{id}.json"))
    }

    fn temp_path(&self, id: &str) -> PathBuf {
        self.state_dir.join(format!("{id}.json.i10r"))
    }

    pub async fn save(&self, state: &DownloadState) -> Result<()> {
        let _guard = self.lock.lock().await;
        self.save_sync(state).await
    }

    pub async fn save_atomic(&self, state: &DownloadState) -> Result<SaveResult> {
        let _guard = self.lock.lock().await;
        let start = now_ms();
        self.save_sync(state).await?;
        Ok(SaveResult {
            last_checkpoint: start,
            last_write_time_ms: now_ms() - start,
        })
    }

    async fn save_sync(&self, state: &DownloadState) -> Result<()> {
        let mut updated = state.clone();
        updated.updated_at = now_ms();
        let target = self.state_path(&state.id);
        let tmp = self.temp_path(&state.id);
        if let Some(dir) = target.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        let json = serde_json::to_vec_pretty(&updated)?;
        tokio::fs::write(&tmp, json).await?;
        tokio::fs::rename(&tmp, &target).await?;
        Ok(())
    }

    pub async fn load(&self, id: &str) -> Option<DownloadState> {
        let p = self.state_path(id);
        let bytes = tokio::fs::read(&p).await.ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        let p = self.state_path(id);
        if tokio::fs::try_exists(&p).await.unwrap_or(false) {
            tokio::fs::remove_file(&p).await?;
        }
        let tmp = self.temp_path(id);
        if tokio::fs::try_exists(&tmp).await.unwrap_or(false) {
            let _ = tokio::fs::remove_file(&tmp).await;
        }
        Ok(())
    }

    pub async fn list_all(&self) -> Vec<DownloadState> {
        let mut out = Vec::new();
        let mut entries = match tokio::fs::read_dir(&self.state_dir).await {
            Ok(e) => e,
            Err(_) => return out,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(bytes) = tokio::fs::read(&path).await {
                if let Ok(state) = serde_json::from_slice::<DownloadState>(&bytes) {
                    out.push(state);
                }
            }
        }
        out
    }

    pub async fn batch_update_chunks(
        &self,
        id: &str,
        updates: &[(usize, u64, bool)],
    ) -> Result<()> {
        let _guard = self.lock.lock().await;
        let Some(mut state) = self.load_unlocked(id).await else {
            return Ok(());
        };
        for &(index, downloaded, completed) in updates {
            if let Some(chunk) = state.chunks.get_mut(index) {
                chunk.downloaded = downloaded;
                chunk.completed = completed;
            }
        }
        self.save_sync(&state).await
    }

    pub async fn get_incomplete_chunks(&self, id: &str) -> Vec<ChunkState> {
        match self.load(id).await {
            Some(s) => s.chunks.into_iter().filter(|c| !c.completed).collect(),
            None => vec![],
        }
    }

    pub async fn add_moved_chunk(&self, id: &str, chunk_index: usize) -> Result<()> {
        let _guard = self.lock.lock().await;
        let Some(mut state) = self.load_unlocked(id).await else {
            return Ok(());
        };
        if !state.moved_chunks.contains(&chunk_index) {
            state.moved_chunks.push(chunk_index);
            state.moved_chunks.sort_unstable();
            self.save_sync(&state).await?;
        }
        Ok(())
    }

    async fn load_unlocked(&self, id: &str) -> Option<DownloadState> {
        let p = self.state_path(id);
        let bytes = tokio::fs::read(&p).await.ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn state_dir(&self) -> &Path {
        &self.state_dir
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
