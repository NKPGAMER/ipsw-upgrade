use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use specta_typescript::Number;
use tauri::{AppHandle, Emitter};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct IPSWFile {
    pub name: String,
    pub path: String,
    #[specta(type = Number)]
    pub size: u64,
}

/// Shared state accessible from both the watcher callback and Tauri commands.
#[derive(Clone)]
pub struct IPSWWatcherState {
    /// All known .ipsw files in the watched directory (path → file).
    pub files: Arc<Mutex<HashMap<String, IPSWFile>>>,
    /// The directory currently being watched.
    pub watch_dir: Arc<Mutex<PathBuf>>,
}

/// Managed Tauri state. Keeps the `RecommendedWatcher` alive so callbacks fire.
pub struct WatcherHandle {
    pub state: IPSWWatcherState,
    /// The watcher is stored here so it isn't dropped. Re-created on `changeDir`.
    watcher: Mutex<Option<RecommendedWatcher>>,
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT: &str = "ipsw:reload";

// ─── Initialisation ──────────────────────────────────────────────────────────

/// Create the shared state, scan the initial directory, and start watching.
pub fn init(app: &AppHandle, initial_dir: PathBuf) -> WatcherHandle {
    let state = IPSWWatcherState {
        files: Arc::new(Mutex::new(HashMap::new())),
        watch_dir: Arc::new(Mutex::new(initial_dir.clone())),
    };

    // Scan existing files
    scan_directory(&state, &initial_dir);

    // Start the file watcher
    let watcher = start_watcher(app, &state, &initial_dir);

    // Emit initial file list
    emit_reload(app, &state);

    WatcherHandle {
        state,
        watcher: Mutex::new(watcher),
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Get a snapshot of all tracked files.
pub fn get_files(state: &IPSWWatcherState) -> Vec<IPSWFile> {
    let map = state.files.lock().expect("files lock poisoned");
    map.values().cloned().collect()
}

/// Delete one or more files from disk and remove them from the tracked map.
/// Emits `ipsw:reload` immediately so the frontend re-fetches without waiting
/// for the filesystem watcher (which may have its own race condition).
pub fn delete_files(
    state: &IPSWWatcherState,
    app: &AppHandle,
    targets: Vec<String>,
) -> Result<(), String> {
    // Delete each file from disk
    for path in &targets {
        if let Err(e) = std::fs::remove_file(path) {
            // If file doesn't exist, that's fine — it may have been deleted already
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Failed to delete {}: {}", path, e));
            }
        }
    }

    // Remove from tracked map
    {
        let mut map = state.files.lock().expect("files lock poisoned");
        for path in &targets {
            map.remove(path);
        }
    }

    // Emit full file list immediately — the watcher Remove event may fire after
    // we've already removed the entry from the map, causing it to skip emission.
    emit_reload(app, state);

    Ok(())
}

/// Change the watched directory. Stops the old watcher, scans the new directory,
/// starts a new watcher, and emits the updated file list.
pub fn change_dir(handle: &WatcherHandle, app: &AppHandle, new_dir: PathBuf) -> Result<(), String> {
    // Resolve the path
    let resolved = new_dir.canonicalize().unwrap_or(new_dir);

    // Normalise for comparison
    let normalise = |p: &Path| {
        p.to_string_lossy()
            .to_lowercase()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string()
    };

    // Skip if same directory
    {
        let current = handle
            .state
            .watch_dir
            .lock()
            .expect("watch_dir lock poisoned");
        if normalise(&resolved) == normalise(&current) {
            return Ok(());
        }
    }

    log::info!("[IPSWWatcher] Reloading dir: {}", resolved.display());

    // Stop old watcher
    {
        let mut w = handle.watcher.lock().expect("watcher lock poisoned");
        *w = None;
    }

    // Update watch dir in shared state
    {
        let mut dir = handle
            .state
            .watch_dir
            .lock()
            .expect("watch_dir lock poisoned");
        *dir = resolved.clone();
    }

    // Scan new directory
    scan_directory(&handle.state, &resolved);

    // Start new watcher
    {
        let mut w = handle.watcher.lock().expect("watcher lock poisoned");
        *w = start_watcher(app, &handle.state, &resolved);
    }

    // Emit full file list
    emit_reload(app, &handle.state);

    Ok(())
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Scan a directory for `.ipsw` files and populate the shared state.
fn scan_directory(state: &IPSWWatcherState, dir: &Path) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            log::error!("[IPSWWatcher] Failed to readdir {}: {}", dir.display(), e);
            return;
        }
    };

    let mut map = state.files.lock().expect("files lock poisoned");
    map.clear();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ipsw") {
            continue;
        }
        if let Some(file) = build_file(&path) {
            map.insert(file.path.clone(), file);
        }
    }
}

/// Build an `IPSWFile` from a path, or `None` if stat fails.
fn build_file(path: &Path) -> Option<IPSWFile> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some(IPSWFile {
        name: path.file_name()?.to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
    })
}

/// Start a `notify` watcher on the given directory.
/// The callback updates the shared state and emits Tauri events.
fn start_watcher(
    app: &AppHandle,
    state: &IPSWWatcherState,
    dir: &Path,
) -> Option<RecommendedWatcher> {
    let files = Arc::clone(&state.files);
    let handle = app.clone();

    let watcher = RecommendedWatcher::new(
        move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                handle_event(&files, &handle, &event);
            }
        },
        Config::default(),
    );

    match watcher {
        Ok(mut w) => {
            if let Err(e) = w.watch(dir, RecursiveMode::NonRecursive) {
                log::error!("[IPSWWatcher] Failed to watch {}: {}", dir.display(), e);
                return None;
            }
            log::info!("[IPSWWatcher] Started watching {}", dir.display());
            Some(w)
        }
        Err(e) => {
            log::error!("[IPSWWatcher] Failed to create watcher: {}", e);
            None
        }
    }
}

/// Handle a single `notify` event.
fn handle_event(files: &Arc<Mutex<HashMap<String, IPSWFile>>>, app: &AppHandle, event: &Event) {
    match &event.kind {
        EventKind::Create(create_kind) => {
            if !matches!(create_kind, notify::event::CreateKind::File) {
                return;
            }
            for path in &event.paths {
                if path.extension().and_then(|e| e.to_str()) != Some("ipsw") {
                    continue;
                }
                log::info!("[IPSWWatcher] File added: {}", path.display());

                if let Some(file) = build_file(path) {
                    let mut map = files.lock().expect("files lock poisoned");
                    map.insert(file.path.clone(), file.clone());
                    drop(map);
                    let _ = app.emit(EVENT, vec![file]);
                }
            }
        }
        EventKind::Remove(remove_kind) => {
            if !matches!(remove_kind, notify::event::RemoveKind::File) {
                return;
            }
            for path in &event.paths {
                if path.extension().and_then(|e| e.to_str()) != Some("ipsw") {
                    continue;
                }

                let path_str = path.to_string_lossy().to_string();
                let mut map = files.lock().expect("files lock poisoned");

                // Verify the file is actually gone (spurious unlink check)
                if map.contains_key(&path_str) && path.exists() {
                    continue; // spurious unlink
                }

                if map.remove(&path_str).is_some() {
                    log::info!("[IPSWWatcher] File removed: {}", path.display());
                    drop(map);
                    // Send empty array to signal removal — frontend will re-fetch
                    let _ = app.emit(EVENT, Vec::<IPSWFile>::new());
                }
            }
        }
        _ => {}
    }
}

/// Emit the full file list to the frontend.
fn emit_reload(app: &AppHandle, state: &IPSWWatcherState) {
    let files = get_files(state);
    let _ = app.emit(EVENT, files);
}
