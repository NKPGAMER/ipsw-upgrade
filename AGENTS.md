# AGENTS.md

## Project overview

**IPSW Manager** — Electron desktop app for managing Apple IPSW firmware files (download, extract, hardlink, cleanup). React frontend + Node.js/Electron backend.

- Author: NKPGAMER
- Platform: Windows (NSIS installer via electron-builder)
- Default language: Vietnamese (`vi`)

## Two compilation targets

The project has two separate TypeScript builds that must not be confused:

| Target | Source | Output | Module | tsconfig | Entry |
|--------|--------|--------|--------|----------|-------|
| Frontend (renderer) | `src/` | `dist/` | ES modules | `tsconfig.app.json` | `src/index.html` + `src/splash.html` |
| Backend (main process) | `electron/` | `electron/dist/` | CommonJS | `tsconfig.main.json` | `electron/main.ts` → `electron/dist/main.js` |

**Critical**: `npm run build:main` compiles `electron/` to `electron/dist/` (CommonJS). `npm run build` (vite) compiles `src/` to `dist/` (ES modules). These are independent — don't mix up their configs.

## Dev commands

```bash
npm run dev          # Full dev: build main process, then run vite + electron concurrently
npm run build:main   # Compile electron/ → electron/dist/ (must run before dev or dist)
npm run build        # Vite build: src/ → dist/
npm run dist         # Production build: build:main → build → electron-builder
npm run lint         # ESLint all files
npm run lint:src     # ESLint frontend only (src/)
npm run lint:electron # ESLint backend only (electron/)
npm run t            # Quick electron launch (electron .)
```

`npm run dev` runs `build:main` first, then `concurrently "vite" "electron ."`. The vite dev server serves `src/` and electron loads it. If you skip `build:main`, electron won't have its compiled output and will crash.

## Path aliases

Defined in `tsconfig.app.json` (frontend only — electron code does NOT use these):

- `@/*` → `./src/*`
- `@pages/*` → `./src/ui/pages/*`
- `@custom-type/*` → `./@types/*`

## ESLint split

ESLint config (`eslint.config.mjs`) applies different rules per area:

- **Frontend** (`src/**`): React Hooks rules enabled (`exhaustive-deps`, `set-state-in-effect`, `immutability`, `refs` — all warn-level)
- **Backend** (`electron/**`): `@typescript-eslint/no-require-imports` off, `no-empty` off, `no-control-regex` off, ternary expressions allowed in `no-unused-expressions`
- **Ignored**: `dist/`, `electron/dist/`, `node_modules/`, `release/`, `electron/i10r-addon/`, `publish/`

`@typescript-eslint/no-explicit-any` is off globally — don't fight this.

## Build & package

- `electron-builder` configured in `package.json` under `"build"` key
- Output goes to `release/` directory
- Windows NSIS installer with differential packages
- Auto-updater via `electron-updater` (GitHub releases, owner `NKPGAMER`, repo `ipsw-manager`)
- `asar: true` — source is packed into the asar archive in production

## Key architecture

- **State management**: Zustand (`src/stores/app-store.ts`, `src/stores/download-store.ts`)
- **Routing**: react-router-dom with HashRouter
- **Animations**: `motion/react` (Framer Motion successor)
- **i18n**: i18next with browser language detection, locales in `src/locales/` (en.json, vi.json)
- **IPC**: Electron IPC between main process and renderer — preload scripts at `electron/preload.ts` and `electron/preload.splash.ts`
- **Electron store**: `electron-store` for persistent settings (defaults in `electron/config.ts`)
- **Core logic**: `src/core/` contains IPSW client, `electron/modules/` contains backend modules (disk, downloader, IPSW watcher, hardlink manager, cleanup)

## Testing

Vitest is a dev dependency but no test scripts are defined in `package.json`. If tests exist, run via `npx vitest` directly.

## Gotchas

- `electron/i10r-addon/` is in the ESLint ignore list — likely contains prebuilt native addons, don't modify
- `publish/` directory is also ESLint-ignored — contains the publish server script, not part of the app
- The `skills-lock.json` at root is for the agent skills system, not app functionality
- `.commandcode/` contains command-code settings and a taste skill — not part of the app
