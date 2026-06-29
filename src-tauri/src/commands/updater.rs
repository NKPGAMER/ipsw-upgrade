use serde::Serialize;

// ─── Types ────────────────────────────────────────────────────────────────────

/// Mirrors the TS `UpdateStatus` interface.
#[derive(Debug, Clone, Serialize)]
#[derive(specta::Type)]
pub struct UpdateStatus {
    pub phase: String,
    pub version: Option<String>,
    pub notes: Option<Vec<String>>,
    pub progress: Option<UpdateProgress>,
}

#[derive(Debug, Clone, Serialize)]
#[derive(specta::Type)]
pub struct UpdateProgress {
    pub percent: f64,
    pub transferred: String,
    pub total: String,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Return the current update status.
/// This is a **stub** — a real implementation would integrate `tauri-plugin-updater`.
/// Maps to `ElectronUpdaterApi.getStatus`.
#[tauri::command]
#[specta::specta]
pub async fn get_update_status() -> UpdateStatus {
    UpdateStatus {
        phase: "no-update".into(),
        version: None,
        notes: None,
        progress: None,
    }
}
