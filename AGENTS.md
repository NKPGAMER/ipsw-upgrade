# Project: IPSW Manager

Electron desktop app for managing Apple firmware (IPSW) files — download, verify, organize, and batch-update device firmware.

## Tech Stack

- **Electron 39** + **React 19** + **TypeScript 5.9**
- **Vite 7** (renderer bundling) + **Tailwind CSS v4** (via `@tailwindcss/vite` plugin)
- **Zustand 5** (renderer state) + **electron-store** (persistent settings)
- **React Router 7** (HashRouter)
- **i18next** (Vietnamese default, English available)

## Commands

```bash
npm run dev          # Build main process + start Vite + Electron concurrently
npm run build        # Vite build only (renderer → dist/)
npm run build:main   # tsc compile electron/ → electron/dist/
npm run dist         # Full production build + electron-builder package
npm run lint         # ESLint (all files)
npm run lint:src     # ESLint (src/ only)
npm run lint:electron # ESLint (electron/ only)
npm run lint:fix     # ESLint --fix
npm run t            # Quick electron launch (electron .)
```

**Build order matters**: `build:main` must complete before Electron can run. `dev` script handles this automatically.

## Architecture

### Two-process model

- **`electron/`** — Main process (Node.js). Entry: `electron/main.ts` → compiles to `electron/dist/main.js`
- **`src/`** — Renderer process (React). Entry: `src/main.tsx` → Vite builds to `dist/`
- **`electron/preload.ts`** — Bridges main↔renderer via `contextBridge`. Exposes `window.api`, `window.store`, `window.downloader`, `window.updater`

### Path aliases

Defined in `tsconfig.app.json`:
- `@/*` → `src/*`
- `@pages/*` → `src/ui/pages/*`
- `@custom-type/*` → `@types/*` (via `tsconfig.base.json`)

### Key directories

| Path | Purpose |
|------|---------|
| `electron/modules/downloader/` | Chunked download engine with worker threads, scheduler, disk manager, integrity checker |
| `electron/modules/ipsw/` | IPSW file cleanup logic |
| `electron/service/` | Data handling (API, metadata, IPSW data, user data) |
| `src/core/` | Renderer-side IPSW client (file list, incomplete tasks) |
| `src/stores/` | Zustand stores (`app-store.ts`, `download-store.ts`) |
| `src/ui/` | React components and pages |
| `@types/` | Shared type declarations (`global.d.ts`, `preload.d.ts`) |

### IPC communication

Main↔renderer communication uses Electron IPC channels:
- `dm:*` — Downloader commands (add, pause, resume, cancel, verify)
- `dh:*` — Data handle (device/model queries)
- `ipsw:*` — IPSW file operations
- `store` — Persistent key-value store
- `updater:*` — Auto-update events

### Two HTML entry points

Vite builds both `src/index.html` (main app) and `src/splash.html` (splash screen) — see `vite.config.ts` rollup input config.

## ESLint quirks

The eslint config has **separate rule sets** for frontend (`src/`), backend (`electron/`), and declaration files. Notable differences:
- `electron/` allows `no-empty`, `no-control-regex`, and `@typescript-eslint/no-require-imports` (CommonJS idioms)
- `electron/` allows ternary-as-statement (`@typescript-eslint/no-unused-expressions` with `allowTernary: true`)
- `src/` uses React 19 rules including `react-hooks/set-state-in-effect`, `react-hooks/immutability`, `react-hooks/refs`
- `@typescript-eslint/no-explicit-any` is **off** globally

## Conventions

- UI text is in **Vietnamese** (vi locale). New UI strings should go in `src/locales/vi.json` and `src/locales/en.json`.
- No test suite exists — there are no `.test.` or `.spec.` files.
- The app enforces single-instance lock (second launches focus existing window).
- Default save directory: user's Downloads folder (overridden via `ipswFolder` setting).
- `plan.md` at root tracks in-progress feature work (currently: incomplete task recovery mechanism).

## Commands
- Use `cmd.exe` to run command
- ex: `cmd.exe npm run build:main`