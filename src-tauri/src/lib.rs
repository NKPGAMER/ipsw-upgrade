mod disk;
mod ipsw;
mod commands;
mod service;
pub mod types;
pub mod config;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, WebviewWindowBuilder, Emitter, Listener, WebviewUrl};

use commands::AppState;
use config::Config;
use service::{ipsw_api, ipsw_data, meta_data, user_data};
// use tauri_plugin_store::{StoreExt};

#[derive(Clone, serde::Serialize)]
struct EmptyPayload {}

const SPLASH_TIMEOUT_MS: u64 = 10_000;

// ─── App Entry ────────────────────────────────────────────────────────────────

/// Generate TypeScript bindings via specta.
/// Run with: `cargo run --bin export-bindings`
#[cfg(debug_assertions)]
pub fn export_typescript_bindings() {
    // Use a thread with large stack to handle deeply recursive type generation
    std::thread::Builder::new()
        .name("specta-export".into())
        .stack_size(128 * 1024 * 1024) // 128 MB stack
        .spawn(|| {
            let _ = tauri_specta::Builder::new()
                .commands(tauri_specta::collect_commands![
                    commands::app::get_version,
                    commands::app::format_bytes,
                    commands::app::relaunch,
                    commands::app::send_message,
                    commands::disk::get_free_space,
                    commands::disk::get_drive_info,
                    commands::disk::list_drives,
                    commands::disk::list_drives_info,
                    commands::disk::get_best_drive,
                    commands::disk::get_environment_info,
                    commands::file::get_files,
                    commands::file::delete_files,
                    commands::file::change_dir,
                    commands::model::get_devices,
                    commands::model::get_model_data,
                    commands::model::get_device_model_data,
                    commands::model::request_model_data,
                    commands::store::store_set,
                    commands::store::store_get,
                    commands::store::store_has,
                    commands::store::store_delete,
                    commands::system::open_folder,
                    commands::system::pick_folder,
                    commands::system::pick_file,
                    commands::system::run_binding,
                    commands::updater::get_update_status,
                ])
                .export(specta_typescript::Typescript::default(), "../src/bind.ts")
                .expect("failed to export TypeScript bindings");
        })
        .unwrap()
        .join()
        .unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Logger plugin (debug only)
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ── Init services ────────────────────────────────
            // let store = app.store("settings.json")?;
            let user_data = user_data::UserData::new(app.handle(), "store");
            let meta = meta_data::MetaData::new(app.handle());
            let api = ipsw_api::IpswAPI::new();
            let cfg = Config::new(app.handle());

            let storage_dir = PathBuf::from("D:\\ShaLouData\\file\\ipsw");

            // let storage_dir = store
            //     .get("storage_dir".to_string())
            //     .and_then(|value| value.as_str().map(PathBuf::from))
            //     .unwrap_or_else(|| app.path().download_dir().unwrap());

            let data_handle = Arc::new_cyclic(|weak| {
                ipsw_data::DataHandle::new(
                    app.handle().clone(),
                    api,
                    meta,
                    user_data,
                    cfg,
                    weak.clone(),
                )
            });

            let watcher_handle = Arc::new(ipsw::watcher::init(
                app.handle(),
                storage_dir,
            ));

            // ── Register managed state ───────────────────────
            let state = AppState {
                data_handle: data_handle.clone(),
                watcher_handle: watcher_handle.clone(),
                user_data: Arc::new(user_data::UserData::new(app.handle(), "store")),
            };
            app.manage(state);

            // ── Main window ──────────────────────────────────
            let _main_window = app
                .get_webview_window("main")
                .expect("main window must exist in tauri.conf.json");

            // ── Splash window ────────────────────────────────
            WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
                .title("IPSW Manager")
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .resizable(false)
                .inner_size(500.0, 420.0)
                .center()
                .build()
                .expect("failed to build splash window");

            // Listen for splash animation complete
            let handle = app.handle().clone();
            app.listen("splash:animation-done", move |_| {
                if let Some(splash) = handle.get_webview_window("splash") {
                    let _ = splash.close();
                }
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            });

            // Signal splash to start animation after a short delay
            let splash_signal = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let _ = splash_signal.emit("splash:ready", EmptyPayload {});

                // Fallback: force close splash after timeout
                std::thread::sleep(std::time::Duration::from_millis(SPLASH_TIMEOUT_MS));
                if let Some(splash) = splash_signal.get_webview_window("splash") {
                    if splash.is_visible().unwrap_or(false) {
                        let _ = splash.close();
                        if let Some(main) = splash_signal.get_webview_window("main") {
                            let _ = main.show();
                            let _ = main.set_focus();
                        }
                    }
                }
            });

            // ── Kick off data loading ────────────────────────
            let dh = data_handle.clone();
            let _ = tauri::async_runtime::spawn(async move {
                dh.load_devices().await.ok();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_version,
            commands::app::format_bytes,
            commands::app::relaunch,
            commands::app::send_message,
            commands::disk::get_free_space,
            commands::disk::get_drive_info,
            commands::disk::list_drives,
            commands::disk::list_drives_info,
            commands::disk::get_best_drive,
            commands::disk::get_environment_info,
            commands::file::get_files,
            commands::file::delete_files,
            commands::file::change_dir,
            commands::model::get_devices,
            commands::model::get_model_data,
            commands::model::get_device_model_data,
            commands::model::request_model_data,
            commands::store::store_set,
            commands::store::store_get,
            commands::store::store_has,
            commands::store::store_delete,
            commands::system::open_folder,
            commands::system::pick_folder,
            commands::system::pick_file,
            commands::system::run_binding,
            commands::updater::get_update_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}