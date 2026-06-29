use std::path::PathBuf;
use std::process::Command;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Open a folder in the native file explorer by its path.
/// Maps to `ElectronApi.system.openFolder`.
#[tauri::command]
#[specta::specta]
pub fn open_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(path.as_os_str())
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(path.as_os_str())
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(path.as_os_str())
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(())
}

/// Open a native dialog to pick a folder, returning the selected path.
/// Maps to `ElectronApi.system.pickFolder`.
#[tauri::command]
#[specta::specta]
pub fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|f| f.to_string()))
}

/// Open a native dialog to pick a file, optionally filtered by extension.
/// Returns the full path of the selected file.
/// Maps to `ElectronApi.system.pickFile`.
#[tauri::command]
#[specta::specta]
pub fn pick_file(
    app: AppHandle,
    filter_name: Option<String>,
    filter_ext: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();

    if let (Some(name), Some(exts)) = (filter_name, filter_ext) {
        let extensions: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &extensions);
    }

    let file = builder.blocking_pick_file();
    Ok(file.map(|f| f.to_string()))
}

/// Run a shell command and return its stdout output.
/// Maps to `ElectronApi.system.runBinding`.
#[tauri::command]
#[specta::specta]
pub fn run_binding(command: String) -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .output()
            .map_err(|e| format!("Failed to run command: {}", e))?
    } else {
        Command::new("sh")
            .args(["-c", &command])
            .output()
            .map_err(|e| format!("Failed to run command: {}", e))?
    };

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!(
            "Command failed with exit code {:?}: {}",
            output.status.code(),
            stderr
        ))
    }
}
