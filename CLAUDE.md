# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

IPSW Manager is an Electron desktop app (v3.0.0) for downloading Apple firmware (IPSW) files. Users can browse all Apple devices, view firmware versions (signed/unsigned, checksums, sizes), and download with multi-connection parallel chunked downloads that support resume.

- **Author**: NKPGAMER — published via GitHub Releases to `NKPGAMER/ipsw-manager`
- **Platform**: Windows (NSIS installer). Cross-platform code exists for macOS/Linux but is untested.
- **Module system**: CommonJS (`"type": "commonjs"` in package.json) — use `import`/`export` syntax (TypeScript compiles to CommonJS everywhere)

## Commands

```bash
npm run dev              # Start dev: Vite dev server + Electron concurrently
npm run build:main       # Compile electron/ TypeScript in watch mode (tsc -p electron -w)
npm run build:renderer   # Compile src/ renderer TypeScript in watch mode (tsc -w)
npm run dist             # Production build + package with electron-builder + publish to GitHub
```

There is no test suite configured.

## Architecture

### Three-process model

```
Main Process (electron/main.ts)
  ├── Spawns Renderer Process (React via Vite)
  └── Spawns Worker Thread (downloader-worker.ts)
```

**Main process** (`electron/main.ts`): Creates BrowserWindow, registers all IPC handlers (`ipcMain.handle`), manages electron-store for persisted settings, initializes auto-updater, and bootstraps core modules (DataHandle, IPSWWatcher, DownloaderMain, IPSWHardLinkManager).

**Renderer process** (`src/`): React 19 + React Router 7 (hash-based routing), Tailwind CSS 4, Zustand 5 for download state, i18next with Vietnamese and English. Rendered pages: Home (`/`), Settings (`/settings`), Downloads (`/downloads`), SelectDevice (`/selectDevice`), IPSWUpdate (`/ipswUpdate`).

**Worker thread** (`electron/modules/downloader/downloader-worker.ts`): Runs the `IPSWDownloader` engine off the main thread to avoid blocking the UI. Communicates with the main thread via `postMessage`.

### IPC: Four API surfaces on `window`

The preload script (`electron/preload.ts`) exposes these via `contextBridge.exposeInMainWorld`:

| Namespace | Purpose |
|-----------|---------|
| `window.api` | File operations, disk space, dialogs, user data, device/firmware data, online state |
| `window.downloader` | Download task CRUD (add/pause/resume/cancel) + event subscriptions (progress, completed, etc.) |
| `window.store` | Persistent key-value store backed by electron-store |
| `window.updater` | Auto-updater controls and events |

Pattern: `ipcMain.handle` / `ipcRenderer.invoke` for request-response; `webContents.send` / `ipcRenderer.on` for server-push events.

### Download engine

Located in `electron/modules/downloader/`. The downloader uses a worker thread to keep I/O off the main thread:

- **`DownloaderMain`** (main thread): Spawns a Node.js `Worker`, registers IPC handlers that forward renderer requests to the worker and relay worker events back to the renderer.
- **`IPSWDownloader`** (worker-only EventEmitter): Core engine composed of:
  - `Scheduler` — concurrency control with "turbo" (high parallel chunks) and "normal" modes, adapts to SSD/HDD
  - `ChunkManager` — parallel chunked HTTP downloads via undici's Pool with retry logic
  - `DiskManager` — pre-download disk space validation
  - `StateManager` — persists download state as JSON files in `{userData}/ipsw-state/`
  - `IntegrityChecker` — SHA1 verification of completed downloads

Download state JSON files in `{userData}/ipsw-state/` are the source of truth for incomplete/resumable downloads.

### Device/firmware data

`DataHandle` (`electron/modules/dataHandle.ts`) wraps the ipsw.me v4 API:
- In-memory cache with 10-minute TTL (`config.cacheTtlMs`)
- Disk cache: JSON files at `{userData}/ipswData/products/{productType}/{identifier}.json`
- Versioned cache staleness detection by comparing stored `lastRelease` with current API release date
- Rate-limited API calls: max 2 concurrent, 300ms delay between starts, exponential backoff retry (3 attempts)
- `getModelDataForReact()` returns null immediately then pushes data asynchronously via IPC event — this is the fire-and-forget pattern used by the renderer

### Configuration constants

`electron/config.ts` holds app-wide tuning parameters: cache TTL, API rate limiting, retry config, default app settings. The `DataVersion` string is used to invalidate stale disk caches.

### File watching

`IPSWWatcher` (chokidar-based) monitors the user's IPSW folder for `.ipsw` files. Requires 3 consecutive identical file-size checks over 1-second intervals (15s timeout) before emitting a file as "stable." `IPSWHardLinkManager` hooks into watcher events to auto-create human-readable hard links in an `IPSW_Files/` subfolder.

## Key TypeScript configs

- **`tsconfig.json`** — Renderer: ESNext target, CommonJS modules, `react-jsx`, strict mode
- **`tsconfig.renderer.json`** — Alternative renderer config (ES2020, ESNext modules, bundler resolution) for IDE support
- **`electron/tsconfig.json`** — Main process: ESNext target, CommonJS modules, strict mode, output to `electron/dist/`

## Type declarations

- **`global.d.ts`** — Shared types used by both main and renderer (Task, Firmware, Device, DownloadMode, EventChannel, etc.)
- **`preload.d.ts`** — Type declarations for the four preload API surfaces (`ElectronApi`, `DownloaderAPI`, `ElectronStoreApi`, `ElectronUpdaterApi`) and global `window` augmentations

## Production build

electron-builder packages to `release/` with NSIS installer on Windows, asar packaging, maximum compression, differential updates. Publishing is via GitHub Releases. The build files filter: `dist/**/*` (excluding source maps, tests, logs).
