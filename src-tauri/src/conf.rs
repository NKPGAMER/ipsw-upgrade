use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// Struct
// Theme
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    Auto    
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AppConfig {
    pub theme: Theme,
    pub language: String,
    pub storage_dir: Option<String>,
    pub state_dir: Option<String>
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: Theme::Auto,
            language: String::from("vi"),
            storage_dir: None,
            state_dir: None
        }
    }
}

pub fn get_config(app: &AppHandle) -> AppConfig {
    let mut config: AppConfig = app.path()
        .app_data_dir()
        .ok()
        .and_then(|mut path| {
            path.push("settings.json");
            std::fs::read_to_string(path).ok()
        })
        .and_then(|json| serde_json::from_str::<AppConfig>(&json).ok())
        .unwrap_or_default();

    config.storage_dir.get_or_insert_with(|| {
        app.path()
            .download_dir()
            .unwrap()
            .to_string_lossy()
            .to_string()
    });

    config.state_dir.get_or_insert_with(|| {
        app.path()
            .app_data_dir()
            .unwrap()
            .join("state")
            .to_string_lossy()
            .to_string()
    });

    return config;
}
