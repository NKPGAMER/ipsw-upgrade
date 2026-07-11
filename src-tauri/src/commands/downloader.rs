use std::sync::Arc;
use tauri::{Emitter, State};

use crate::commands::AppState;
use crate::downloader::engine::DownloaderEngine;
use crate::downloader::types::*;

fn engine<'a>(state: &'a State<'_, AppState>) -> &'a Arc<DownloaderEngine> {
    &state.downloader_engine
}

#[tauri::command]
#[specta::specta]
pub async fn dm_add(
    state: State<'_, AppState>,
    firmware: Firmware,
    save_path: String,
) -> Result<AddResult, String> {
    Ok(crate::downloader::commands::add(engine(&state), firmware, save_path).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_pause(
    state: State<'_, AppState>,
    id: String,
) -> Result<LifecycleResult, String> {
    Ok(crate::downloader::commands::pause(engine(&state), id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_resume(
    state: State<'_, AppState>,
    id: String,
) -> Result<LifecycleResult, String> {
    Ok(crate::downloader::commands::resume(engine(&state), id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_cancel(
    state: State<'_, AppState>,
    id: String,
) -> Result<LifecycleResult, String> {
    Ok(crate::downloader::commands::cancel(engine(&state), id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_get_all_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    Ok(crate::downloader::commands::get_all_tasks(engine(&state)).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_get_incomplete_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<IncompleteTask>, String> {
    Ok(crate::downloader::commands::get_incomplete_tasks(engine(&state)).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_resume_incomplete(
    state: State<'_, AppState>,
    id: String,
) -> Result<LifecycleResult, String> {
    Ok(crate::downloader::commands::resume_incomplete(engine(&state), id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_delete_incomplete(
    state: State<'_, AppState>,
    id: String,
) -> Result<LifecycleResult, String> {
    Ok(crate::downloader::commands::delete_incomplete(engine(&state), id).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dm_get_environment_info(
    state: State<'_, AppState>,
    save_path: String,
) -> Result<DiskEnvironmentInfo, String> {
    Ok(crate::downloader::commands::get_environment_info(engine(&state), save_path).await)
}

#[tauri::command]
#[specta::specta]
pub fn dm_set_boost(state: State<'_, AppState>, enabled: bool) {
    crate::downloader::commands::set_boost(engine(&state), enabled);
}

/// Spawn the event-forwarding bridge from the downloader engine's EventBus
/// to Tauri's frontend event system (`app_handle.emit(...)`).
pub fn spawn_event_forwarder(
    app_handle: tauri::AppHandle,
    engine: Arc<DownloaderEngine>,
) {
    let mut rx = engine.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = rx.recv().await {
            match event {
                crate::downloader::events::Event::Started { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:started",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Progress { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:progress",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Completed { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:completed",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Error {
                    task_id,
                    error,
                    task,
                } => {
                    let _ = app_handle.emit(
                        "dm:error",
                        serde_json::json!({ "task_id": task_id, "error": error, "task": task }),
                    );
                }
                crate::downloader::events::Event::Paused { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:paused",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Resumed { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:resumed",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Added { task_id, task } => {
                    let _ = app_handle.emit(
                        "dm:added",
                        serde_json::json!({ "task_id": task_id, "task": task }),
                    );
                }
                crate::downloader::events::Event::Cancelled { task_id } => {
                    let _ = app_handle.emit(
                        "dm:cancelled",
                        serde_json::json!({ "task_id": task_id }),
                    );
                }
                crate::downloader::events::Event::IncompleteDeleted { id } => {
                    let _ = app_handle.emit(
                        "dm:incomplete_deleted",
                        serde_json::json!({ "id": id }),
                    );
                }
                crate::downloader::events::Event::BudgetChanged {
                    task_id,
                    connections,
                } => {
                    let _ = app_handle.emit(
                        "dm:budget_changed",
                        serde_json::json!({ "task_id": task_id, "connections": connections }),
                    );
                }
            }
        }
    });
}
