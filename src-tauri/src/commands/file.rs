use std::path::PathBuf;

use tauri::AppHandle;

use crate::commands::AppState;
use crate::ipsw::watcher::IPSWFile;

/// Return all tracked `.ipsw` files in the watched directory.
/// Maps to `ElectronApi.file.getFiles`.
#[tauri::command]
#[specta::specta]
pub fn get_files(state: tauri::State<'_, AppState>) -> Result<Vec<IPSWFile>, String> {
    Ok(crate::ipsw::watcher::get_files(&state.watcher_handle.state))
}

/// Delete one or more `.ipsw` files from disk *and* the tracked list.
/// Accepts an array of absolute file paths.
/// Maps to `ElectronApi.file.delete`.
#[tauri::command]
#[specta::specta]
pub fn delete_files(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    targets: Vec<String>,
) -> Result<(), String> {
    crate::ipsw::watcher::delete_files(&state.watcher_handle.state, &app, targets)
}

/// Switch the watched directory. Stops the old watcher, scans the new directory,
/// starts a fresh watcher, and emits the updated file list on `ipsw:reload`.
/// Maps to `ElectronApi.file.changeDir`.
#[tauri::command]
#[specta::specta]
pub async fn change_dir(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    new_dir: String,
) -> Result<(), String> {
    let path = PathBuf::from(&new_dir);
    crate::ipsw::watcher::change_dir(&*state.watcher_handle, &app, path)
}
