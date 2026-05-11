# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

IPSW Manager is an Electron desktop app (v3.1.0) for downloading Apple firmware (IPSW) files. Users can browse all Apple devices, view firmware versions (signed/unsigned, checksums, sizes), and download with multi-connection parallel chunked downloads that support resume.

- **Author**: NKPGAMER — published via GitHub Releases to `NKPGAMER/ipsw-manager`
- **Platform**: Windows (NSIS installer). Cross-platform code exists for macOS/Linux but is untested.
- **Module system**: CommonJS (`"type": "commonjs"` in package.json) — use `import`/`export` syntax (TypeScript compiles to CommonJS everywhere)

## Commands

```bash
npm run dev              # Start dev: Vite dev server + Electron concurrently
npm run build            # Full compile: tsc electron/ then vite build renderer
npm run build:main       # Compile electron/ TypeScript in watch mode (tsc -p electron -w)
npm run build:renderer   # Compile src/ renderer TypeScript in watch mode (tsc -w)
npm run dist             # Production build + package with electron-builder + publish to GitHub
npm run t                # Launch Electron only (no Vite dev server — requires pre-built dist/)
npm run start            # Alias for npm run dev
```

There is no test suite configured.

## Architecture

### Three-process model

```
Main Process (electron/main.ts)
  ├── Spawns Renderer Process (React via Vite)
  └── Spawns Worker Thread (downloader-worker.ts)
  └── Splash Window (splash.html) — shown while app initializes, destroyed when main window fires "ready-to-show"
```

**Main process** (`electron/main.ts`): Creates BrowserWindow, registers all IPC handlers (`ipcMain.handle`), manages electron-store for persisted settings, initializes auto-updater, and bootstraps core modules (DataHandle, IPSWWatcher, DownloaderMain, IPSWHardLinkManager, IPSWCleanupManager). A splash window is shown during init and destroyed once `ready-to-show` fires (10s fallback timeout).

**Renderer process** (`src/`): React 19 + React Router 7 (hash-based routing), Tailwind CSS 4, Zustand 5 for download state, i18next with Vietnamese and English. Rendered pages: Home (`/`), Settings (`/settings`), Downloads (`/downloads`), SelectDevice (`/selectDevice`), IPSWUpdate (`/ipswUpdate`), Welcome (`/welcome`). Entry: `index.html` → `src/main.tsx` → `src/App.tsx` (router).

**Worker thread** (`electron/modules/downloader/downloader-worker.ts`): Runs the `IPSWDownloader` engine off the main thread to avoid blocking the UI. Communicates with the main thread via `postMessage` using a typed message protocol (`worker-messages.ts`).

### IPC: Four API surfaces on `window`

The preload script (`electron/preload.ts`) exposes these via `contextBridge.exposeInMainWorld`:

| Namespace | Purpose |
|-----------|---------|
| `window.api` | File operations, disk space, dialogs, user data, device/firmware data, online state |
| `window.downloader` | Download task CRUD (add/pause/resume/cancel) + event subscriptions (progress, completed, etc.) |
| `window.store` | Persistent key-value store backed by electron-store |
| `window.updater` | Auto-updater controls and events |

Pattern: `ipcMain.handle` / `ipcRenderer.invoke` for request-response; `webContents.send` / `ipcRenderer.on` for server-push events.

### Source initialization pipeline

`src/data.ts` holds a mutable global `state` object (non-reactive, used for settings flags) and `data.localFiles`. `src/index.ts` initializes by loading persisted settings from electron-store into this state object, then sets `state.__init = true`.

`src/core/ipswClient.ts` is the renderer-side `IPSWClient` class that subscribes to file-watcher events via `window.api.file.onReload`, maintains a local copy of the IPSW file list, manages incomplete (resumable) download tasks, and notifies UI components via callbacks.

### Download engine

Located in `electron/modules/downloader/`. The downloader uses a worker thread to keep I/O off the main thread:

- **`DownloaderMain`** (main thread): Spawns a Node.js `Worker` (256MB heap limit), registers IPC handlers that forward renderer requests to the worker and relay worker events back to the renderer. Uses `randomUUID` request IDs to match replies to pending calls.
- **`IPSWDownloader`** (worker-only EventEmitter): Core engine composed of:
  - `Scheduler` — concurrency control with "turbo" (high parallel chunks) and "normal" modes, adapts to SSD/HDD. Supports promotion (normal→turbo) and demotion (turbo→normal), preemption for turbo slots.
  - `ChunkManager` — parallel chunked HTTP downloads via undici's Pool with retry logic. Supports progressive write mode (turbo HDD+SSD) where chunks move to a `.turbo` file during download.
  - `DiskManager` — pre-download disk space validation, SSD/HDD detection, temp directory selection (prefers SSD for tmp).
  - `StateManager` — persists download state as JSON files in `{userData}/ipsw-state/`
  - `IntegrityChecker` — SHA1 verification of completed downloads
  - `MoveQueue` — per-drive-queue for moving tmp→final files (rename or kernel copy with progress). SSD limit 3 concurrent, HDD limit 2. Buffer size adapts to file size and available memory.
- **Turbo HDD+SSD mode**: When save path is HDD and a faster SSD is available for temp, chunks download to SSD first, get progressively moved to a `.turbo` file on the HDD during download, and finally renamed to the `.ipsw` destination.

Download state JSON files in `{userData}/ipsw-state/` are the source of truth for incomplete/resumable downloads.

### Device/firmware data

`DataHandle` (`electron/modules/dataHandle.ts`) wraps the ipsw.me v4 API:
- In-memory cache with 10-minute TTL (`config.cacheTtlMs`)
- Disk cache: JSON files at `{userData}/ipswData/products/{productType}/{identifier}.json`
- Versioned cache staleness detection by comparing stored `lastRelease` with current API release date
- Rate-limited API calls: max 2 concurrent, 300ms delay between starts, exponential backoff retry (3 attempts)
- `getModelDataForReact()` returns null immediately then pushes data asynchronously via IPC event — this is the fire-and-forget pattern used by the renderer

### File watching & cleanup

**`IPSWWatcher`** (chokidar-based, `electron/modules/ipswWatcher.ts`) monitors the user's IPSW folder for `.ipsw` files. Requires 3 consecutive identical file-size checks over 1-second intervals (15s timeout) before emitting a file as "stable." Supports debounced directory changes (queues pending requests). IPC channels: `ipsw:reload`, `ipsw:change-dir`, `ipsw:delete-file`, `ipsw:get-files`.

**`IPSWHardLinkManager`** (`electron/modules/ipswHardLinkManager.ts`) hooks into watcher events to auto-create human-readable hard links in an `IPSW_FILES/` subfolder. Parses IPSW filenames, matches against device data from DataHandle to create organized filenames like `iPhone_X_(version).ipsw`.

**`IPSWCleanupManager`** (`electron/modules/ipsw/cleanup.ts`) handles three cleanup modes: removing orphaned `.turbo` and `.tmp` files, deleting old firmware versions, and deleting duplicate firmware files. Uses DataHandle to determine which files are redundant.

### Renderer state management

**Zustand store** (`src/stores/download-store.ts`): Holds `taskIds[]` and `tasksById{}`, plus a `filter` for the downloads page view. Updated by download events (`onAdded`, `onProgress`, `onCompleted`, etc.) from the preload API.

**i18next** (`src/i18n.ts`): Uses browser language detection, supports `vi` and `en` from `src/locales/vi.json` and `src/locales/en.json`. Implements a `data-t` attribute-based DOM translation system (not just React component integration).

### Configuration constants

`electron/config.ts` holds app-wide tuning parameters: cache TTL, API rate limiting, retry config, default app settings, and `appleVendorId` (1452, used for USB device matching). The `DataVersion` string is used to invalidate stale disk caches.

### Utility modules

| Module | Purpose |
|--------|---------|
| `electron/modules/userData.ts` | Read/write/delete JSON files in `{userData}/` directory |
| `electron/modules/disk.ts` | Cross-platform disk space querying (PowerShell on Windows, `df` on Unix) + `formatBytes` |
| `electron/modules/localFile.ts` | `scanFolder()` for `.ipsw` files, `createMd5()` with progress callback, `deleteFile()` |
| `electron/utils/system.ts` | `selectFolder()`, `selectFile()` dialogs, `sendMessage()` for toast notifications to renderer |
| `electron/utils/fs-utils.ts` | `ensureDir()`, `isRoot()` path helpers |

## Key TypeScript configs

- **`tsconfig.json`** — Renderer: ESNext target, CommonJS modules, `react-jsx`, strict mode, `resolveJsonModule: true`
- **`tsconfig.renderer.json`** — Alternative renderer config (ES2020, ESNext modules, bundler resolution) for IDE support
- **`electron/tsconfig.json`** — Main process: ESNext target, CommonJS modules, strict mode, output to `electron/dist/`

## Type declarations

- **`global.d.ts`** — Shared types used by both main and renderer (Task, Firmware, Device, DownloadMode, EventChannel, etc.)
- **`preload.d.ts`** — Type declarations for the four preload API surfaces (`ElectronApi`, `DownloaderAPI`, `ElectronStoreApi`, `ElectronUpdaterApi`) and global `window` augmentations (also includes Device, Firmware, IPSWFile, and other shared interfaces)

## Production build

electron-builder packages to `release/` with NSIS installer on Windows, asar packaging, maximum compression, differential updates, GitHub auto-publish. Build files filter: `dist/**/*` (excluding source maps, tests, logs).
