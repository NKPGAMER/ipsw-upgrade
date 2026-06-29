---
name: rust-tauri
description: >
  Guide for coding agent on Rust and Tauri v2. Activate this skill when working with
  any .rs file, fixing Rust/Tauri bugs, adding new features to the Tauri backend,
  porting code to Rust, writing Tauri commands/events/plugins, handling async with tokio,
  managing state with Arc<Mutex<>>, or integrating Tauri with the frontend. Always use
  this skill when Rust, Cargo, Tauri, or crates like tokio/serde/reqwest are mentioned.
---

# Rust + Tauri v2 — Coding Agent Skill

You are a senior Rust engineer with deep Tauri v2 experience. Every change must be **correct at the root**, not a quick patch. Before fixing, clearly analyze the root cause.

---

## 0. General workflow

```
Read error / requirement
  → Analyze root cause
  → Gather sufficient information (ask once if missing)
  → Implement
  → cargo check / cargo build / cargo test
  → Read output, fix errors top-down
  → Repeat until clean
```

**Never** commit code that hasn't passed `cargo check`.

---

## 1. Information gathering — ask once, ask enough

Before writing code, identify what's missing and **ask everything in a single message**:

- Do related structs/types already exist?
- Which crates are in use (version)?
- Expected behavior on error (panic / Result / fallback)?
- Is there shared state? Who owns it?
- Is this command public (callable from JS) or internal?

Don't ask again after receiving sufficient information.

---

## 2. Fixing errors — root cause, not patch

### Principles
- Read the **entire** compiler output, not just the first error.
- Fix errors **top-down** — later errors are often consequences of earlier ones.
- Understand **why** the error occurs before fixing.
- Don't use `.unwrap()` to "silence" borrow checker or type mismatch errors.
- Don't `#[allow(...)]` to hide warnings — truly fix them.

### Run commands in order

```bash
# Quick check, no build
cargo check

# Full build
cargo build

# Run tests
cargo test

# Auto check + fix (only when confident)
cargo fix --allow-dirty

# View warnings/errors in detail
RUST_BACKTRACE=1 cargo build 2>&1

# With Tauri
cargo tauri build
cargo tauri dev
```

### Reading output correctly

```
error[E0502]: cannot borrow `x` as mutable because it is also borrowed as immutable
  --> src/main.rs:10:5
   |
9  |     let r = &x;          ← borrow starts here
10 |     x.push(1);           ← mutable borrow conflicts
   |     ^^^^^^^^^
```

Always read the compiler's **annotation lines** (`|`) — they point to the root location.

---

## 3. Standard Rust patterns in the project

### Async with tokio

```rust
// ✅ Correct — use tokio::spawn for background tasks
tokio::spawn(async move {
    // task runs independently
});

// ✅ Correct — async fn in Tauri command
#[tauri::command]
async fn my_command(state: State<'_, AppState>) -> Result<String, String> {
    let data = state.inner().fetch().await.map_err(|e| e.to_string())?;
    Ok(data)
}

// ❌ Wrong — blocking in async context
std::thread::sleep(Duration::from_secs(1)); // use tokio::time::sleep instead
```

### Shared state with Arc<Mutex<>>

```rust
// Define state
#[derive(Default)]
pub struct AppState {
    pub data: Arc<Mutex<Option<MyData>>>,
}

// Access correctly
async fn access_state(state: &AppState) -> Result<(), Error> {
    let mut guard = state.data.lock().await; // tokio::sync::Mutex
    *guard = Some(new_data);
    Ok(())
} // guard dropped here — don't hold lock across .await

// ❌ Wrong — holding MutexGuard across await boundary
let guard = state.data.lock().await;
some_async_fn().await; // compile error with std::Mutex
*guard = value;
```

### Semaphore for concurrency limiting

```rust
use tokio::sync::Semaphore;

let sem = Arc::new(Semaphore::new(4)); // max 4 concurrent tasks
let permit = sem.clone().acquire_owned().await?;
tokio::spawn(async move {
    let _permit = permit; // hold permit, auto-drop when task ends
    do_work().await;
});
```

### Error handling — no unwrap in production

```rust
// Define error type
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Custom(String),
}

// In Tauri command — serialize error as String for JS
#[tauri::command]
async fn fetch_data() -> Result<Data, String> {
    do_something().await.map_err(|e| e.to_string())
}
```

### serde for JSON

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] // ← match JS naming
pub struct DeviceInfo {
    pub device_id: String,
    pub model_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
}
```

---

## 4. Tauri v2 — Patterns & Rules

### Command registration (v2 syntax)

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_devices,
            commands::download_ipsw,
            commands::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Standard command structure

```rust
// src-tauri/src/commands/mod.rs
#[tauri::command]
pub async fn get_devices(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<DeviceInfo>, String> {
    let devices = state.device_manager
        .lock().await
        .get_all()
        .await
        .map_err(|e| e.to_string())?;
    Ok(devices)
}
```

### Emit events from Rust → JS

```rust
// Emit to all windows
app.emit("download-progress", ProgressPayload {
    id: download_id,
    percent: 42.5,
}).map_err(|e| e.to_string())?;

// Emit to a specific window
app.get_webview_window("main")
    .ok_or("window not found")?
    .emit("download-done", &result)?;

// Payload must be Serialize
#[derive(Clone, Serialize)]
struct ProgressPayload {
    id: String,
    percent: f32,
}
```

### Tauri v2 Permissions (tauri.conf.json)

```json
{
  "app": {
    "security": {
      "capabilities": [
        {
          "identifier": "main-capability",
          "description": "App capabilities",
          "windows": ["main"],
          "permissions": [
            "core:default",
            "shell:allow-open",
            "fs:allow-read-app-data",
            "fs:allow-write-app-data"
          ]
        }
      ]
    }
  }
}
```

Common Tauri v2 permissions:
| Permission | Purpose |
|---|---|
| `core:default` | Basic window, event, app |
| `fs:allow-read-app-data` | Read app data directory |
| `fs:allow-write-app-data` | Write app data directory |
| `shell:allow-open` | Open external URL/file |
| `http:default` | HTTP requests from frontend |
| `dialog:default` | File/folder picker |
| `notification:default` | System notification |

### Path helpers (Tauri v2)

```rust
use tauri::Manager;

// App data directory (Windows: %APPDATA%\<bundle.identifier>)
let app_data = app.path().app_data_dir()?;

// Cache directory
let cache_dir = app.path().app_cache_dir()?;

// Create directory if missing
std::fs::create_dir_all(&app_data)?;
```

### Plugin system (v2)

```rust
// In Cargo.toml
// tauri-plugin-store = "2"
// tauri-plugin-shell = "2"

// In lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_shell::init())
```

---

## 5. Standard project structure

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/          ← permissions (Tauri v2)
└── src/
    ├── lib.rs             ← Builder setup, plugin, manage state
    ├── main.rs            ← Entry point (only calls lib::run())
    ├── error.rs           ← AppError enum
    ├── state.rs           ← AppState struct
    ├── commands/
    │   ├── mod.rs
    │   ├── device.rs
    │   └── download.rs
    └── services/
        ├── mod.rs
        ├── api.rs         ← HTTP/API calls
        └── storage.rs     ← File I/O
```

### Required Cargo.toml dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
thiserror = "1"
anyhow = "1"
log = "0.4"
tracing = "0.1"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

---

## 6. Borrow checker — common pitfalls

### Clone instead of borrow when needed

```rust
// ❌ Wrong — borrow and mutate simultaneously
let name = &self.items[0].name;
self.items.push(new_item); // error: cannot borrow while borrowed

// ✅ Correct
let name = self.items[0].name.clone();
self.items.push(new_item);
```

### Lifetimes in structs

```rust
// ❌ Avoid lifetimes in structs unless truly needed
struct Manager<'a> {
    config: &'a Config, // often causes complexity
}

// ✅ Use Arc to share ownership
struct Manager {
    config: Arc<Config>,
}
```

### Mutex in async — use tokio, not std

```rust
// ❌ Wrong with async — std::Mutex is not Send across await
use std::sync::Mutex;
let guard = mutex.lock().unwrap();
async_fn().await; // compile error

// ✅ Correct
use tokio::sync::Mutex;
let guard = mutex.lock().await;
async_fn().await; // OK
```

---

## 7. Testing

```bash
# Run all tests
cargo test

# Run a specific test
cargo test test_name

# Run test with output
cargo test -- --nocapture

# Run integration tests
cargo test --test integration_tests

# Check before testing
cargo check && cargo test
```

### Writing tests correctly

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test] // ← use for async tests
    async fn test_fetch_devices() {
        let state = AppState::default();
        let result = get_all_devices(&state).await;
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result);
    }

    #[test]
    fn test_parse_version() {
        let v = parse_version("16.5.1").unwrap();
        assert_eq!(v.major, 16);
        assert_eq!(v.minor, 5);
    }
}
```

---

## 8. Completion checklist

- [ ] `cargo check` has no errors
- [ ] `cargo build` succeeds
- [ ] No `.unwrap()` in production code (only in tests)
- [ ] No remaining `todo!()` / `unimplemented!()`
- [ ] Error messages are meaningful, not "error occurred"
- [ ] No `MutexGuard` held across `.await` boundary
- [ ] Tauri commands return `Result<T, String>` (serializable)
- [ ] State is injected via `State<'_, AppState>`, not global
- [ ] `#[derive(Clone)]` on types used in event emit
- [ ] New files are declared in the corresponding `mod`

---

## 9. Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `cannot borrow as mutable, also borrowed as immutable` | Borrow conflict | Clone or restructure scope |
| `future cannot be sent between threads safely` | Type not `Send` | Wrap in `Arc`, use `tokio::sync` |
| `the trait Send is not implemented for MutexGuard` | Holding std::MutexGuard across await | Use `tokio::sync::Mutex` |
| `command not found` in Tauri | Not registered in `generate_handler!` | Add to invoke_handler |
| `undefined is not a function` in JS | Wrong command name (snake_case vs camelCase) | Tauri auto-converts `my_fn` → `my_fn`, double-check |
| `Permission denied` when using fs | Missing capability | Add to `tauri.conf.json` capabilities |
| `type mismatch: expected String, found &str` | Lifetime/ownership | `.to_string()` or `.to_owned()` |
