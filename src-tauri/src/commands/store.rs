use serde_json::Value;

use crate::commands::AppState;
use crate::types::json_value::JsonValue;

/// The persisted settings file name used under the hood.
const SETTINGS_FILE: &str = "settings.json";

/// Set a value in the persistent store by key.
/// Maps to `ElectronStoreApi.set`.
#[tauri::command]
#[specta::specta]
pub async fn store_set(
    state: tauri::State<'_, AppState>,
    key: String,
    value: JsonValue,
) -> Result<(), String> {
    // Read current, mutate, write back
    let mut current: serde_json::Map<String, Value> = state
        .user_data
        .read::<serde_json::Map<String, Value>>(SETTINGS_FILE, None)
        .await
        .unwrap_or_default();
    current.insert(key, value.0);
    state
        .user_data
        .write(SETTINGS_FILE, &current)
        .await
        .map_err(|e| e.to_string())
}

/// Get a value from the persistent store by key.
/// Returns `null` when the key does not exist.
/// Maps to `ElectronStoreApi.get`.
#[tauri::command]
#[specta::specta]
pub async fn store_get(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<JsonValue, String> {
    let current: serde_json::Map<String, Value> = state
        .user_data
        .read::<serde_json::Map<String, Value>>(SETTINGS_FILE, None)
        .await
        .unwrap_or_default();
    Ok(JsonValue(current.get(&key).cloned().unwrap_or(Value::Null)))
}

/// Check whether a key exists in the persistent store.
/// Maps to `ElectronStoreApi.has`.
#[tauri::command]
#[specta::specta]
pub async fn store_has(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<bool, String> {
    let current: serde_json::Map<String, Value> = state
        .user_data
        .read::<serde_json::Map<String, Value>>(SETTINGS_FILE, None)
        .await
        .unwrap_or_default();
    Ok(current.contains_key(&key))
}

/// Delete a key from the persistent store.
/// Maps to `ElectronStoreApi.delete`.
#[tauri::command]
#[specta::specta]
pub async fn store_delete(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let mut current: serde_json::Map<String, Value> = state
        .user_data
        .read::<serde_json::Map<String, Value>>(SETTINGS_FILE, None)
        .await
        .unwrap_or_default();
    current.remove(&key);
    state
        .user_data
        .write(SETTINGS_FILE, &current)
        .await
        .map_err(|e| e.to_string())
}
