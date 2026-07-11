pub mod app;
pub mod disk;
pub mod downloader;
pub mod file;
pub mod model;
pub mod store;
pub mod system;
pub mod updater;

use std::sync::Arc;

use crate::downloader::DownloaderEngine;
use crate::ipsw::watcher::WatcherHandle;
use crate::service::ipsw_data::DataHandle;
use crate::service::user_data::UserData;

/// Application-wide managed state shared between Tauri commands.
pub struct AppState {
    pub data_handle: Arc<DataHandle>,
    pub watcher_handle: Arc<WatcherHandle>,
    pub user_data: Arc<UserData>,
    pub downloader_engine: Arc<DownloaderEngine>,
}
