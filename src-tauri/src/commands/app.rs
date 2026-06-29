use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Return the current app version from Cargo.toml.
/// Maps to `ElectronApi.getVersion`.
#[tauri::command]
#[specta::specta]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string() + "-R"
}

/// Format a byte count into a human-readable string (e.g. "1.23 GB").
/// Maps to `ElectronApi.formatBytes`.
#[tauri::command]
#[specta::specta]
pub fn format_bytes(bytes: f64, decimals: Option<u32>) -> String {
    let decimals = decimals.unwrap_or(2) as usize;
    if bytes <= 0.0 {
        return "0 B".to_string();
    }
    let units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let base = 1024.0_f64;
    let exponent = (bytes.ln() / base.ln()).floor() as usize;
    let exponent = exponent.min(units.len() - 1);
    let value = bytes / base.powi(exponent as i32);
    // Use floating-point formatting with dynamic precision
    let formatted = format!("{v:.prec$}", v = value, prec = decimals);
    format!("{} {}", formatted, units[exponent])
}

/// Restart the application process.
/// Maps to `ElectronApi.relaunch`.
#[tauri::command]
#[specta::specta]
pub async fn relaunch(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

// ─── Message helpers ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[derive(specta::Type)]
pub struct MessagePayload {
    pub message: String,
    #[serde(rename = "type")]
    pub message_type: String,
}

/// Send a toast / notification message to the frontend.
/// The frontend should `listen("app:message", ...)`.
/// Maps to `ElectronApi.onMessage` (emit side).
#[tauri::command]
#[specta::specta]
pub async fn send_message(
    app: AppHandle,
    message: String,
    message_type: String,
) -> Result<(), String> {
    let payload = MessagePayload {
        message,
        message_type,
    };
    app.emit("app:message", payload)
        .map_err(|e| format!("Failed to emit message: {e}"))
}
