use serde::Serialize;
use tauri::Emitter;

use crate::commands::AppState;
use crate::service::ipsw_data::{GetResult, Product};
use crate::types::ipsw_api::{BaseDevice, DeviceWithIpsws};

// ─── ModelDataResult ──────────────────────────────────────────────────────────

/// Matches the TS `ModelDataResult` tagged union:
///   `{ status: "ready", data: DeviceResponse } | { status: "wait" }`
#[derive(Debug, Clone, Serialize)]
#[derive(specta::Type)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ModelDataResult {
    Ready(DeviceWithIpsws),
    Wait,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Get a filtered (or full) list of known devices.
/// Maps to `ElectronApi.getDevices`.
#[tauri::command]
#[specta::specta]
pub async fn get_devices(
    state: tauri::State<'_, AppState>,
    product: Option<Product>,
) -> Result<Vec<BaseDevice>, String> {
    let devices = state.data_handle.get_devices(product.as_ref()).await;
    Ok(devices)
}

/// Fetch full model data (firmwares, boards, etc.) for a device identifier.
/// Returns `ModelDataResult::Wait` if the data isn't cached yet — the frontend
/// should listen on `dh:modelData` for the async response.
/// Maps to `ElectronApi.getModelData`.
#[tauri::command]
#[specta::specta]
pub async fn get_model_data(
    state: tauri::State<'_, AppState>,
    identifier: String,
) -> Result<ModelDataResult, String> {
    let result = state.data_handle.get(&identifier).await;
    match result {
        GetResult::Ready(device) => Ok(ModelDataResult::Ready(device)),
        GetResult::Wait => Ok(ModelDataResult::Wait),
    }
}

/// Check if model data is available locally, returning immediately.
/// Returns `ModelDataResult::Ready` if cached data exists, or `Wait` otherwise.
/// Maps to `ElectronApi.getDeviceModelData`.
#[tauri::command]
#[specta::specta]
pub async fn get_device_model_data(
    state: tauri::State<'_, AppState>,
    identifier: String,
) -> Result<ModelDataResult, String> {
    let has_local = state
        .data_handle
        .has_local_data("modelData", Some(&identifier))
        .await;
    if !has_local {
        return Ok(ModelDataResult::Wait);
    }
    match state
        .data_handle
        .get_model_data(&identifier, true)
        .await
    {
        Some(device) => Ok(ModelDataResult::Ready(device)),
        None => Ok(ModelDataResult::Wait),
    }
}

/// Trigger an async model-data fetch for the given identifier.
/// The result arrives later on the `dh:modelData` event channel.
/// Maps to `ElectronApi.requestModelData`.
#[tauri::command]
#[specta::specta]
pub async fn request_model_data(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    identifier: String,
) -> Result<(), String> {
    // Signal "wait" immediately, then dispatch the async fetch
    let _ = app.emit(
        "dh:modelData",
        (identifier.as_str(), Option::<DeviceWithIpsws>::None),
    );
    state.data_handle.get_model_data_for_react(&identifier).await;
    Ok(())
}
