use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// ─── App Settings ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub storage_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct FeatureSettings {
    pub auto_remove_redundant_files: bool,

}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct Settings {
    pub app: AppSettings,
    pub features: FeatureSettings,
}

impl Settings {
    fn new(app: &AppHandle) -> Self {
        Self {
            app: AppSettings {
                language: "vi".to_string(),
                theme: "dark".to_string(),
                storage_dir: app.path().download_dir().unwrap()
            },
            
            features: FeatureSettings {
                auto_remove_redundant_files: false
            }
        }
    }
}

// ─── Config ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Config {
    pub default_app_settings: Settings,

    pub data_version: &'static str,

    pub apple_vendor_id: u16,

    /// 10 min in-memory TTL
    pub cache_ttl_ms: u64,
    /// Parallel API requests
    pub max_concurrent_fetches: usize,
    /// ms between starting requests
    pub request_delay_ms: u64,
    /// Retries per fetch
    pub max_retries: usize,
    /// Base delay (× 2^attempt) for backoff
    pub retry_base_delay_ms: u64,
}

impl Config {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            default_app_settings: Settings::new(app),
            data_version: "2.2.2",
            apple_vendor_id: 1452,
            cache_ttl_ms: 600_000,
            max_concurrent_fetches: 2,
            request_delay_ms: 300,
            max_retries: 3,
            retry_base_delay_ms: 1_000,
        }
    }
}