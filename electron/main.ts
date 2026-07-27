// ─── Electron ──────────────────────────────────────────────────────────────────
import { app, BrowserWindow, screen, globalShortcut, ipcMain } from "electron";
import { join } from "path";
// ─── Boot ──────────────────────────────────────────────────────────────────────
import { state, storeGet, s } from "./boot/app-state";
import { createSplashWindow, createMainWindow, loadRenderer } from "./boot/windows";
import { initAutoUpdater } from "./boot/auto-updater";
import "./boot/ipc-handlers";
// ─── Modules & Services ────────────────────────────────────────────────────────
import { DownloaderMain } from "./modules/downloader";
import { DataHandle } from "./services/ipswData";
import { IPSWWatcher } from "./modules/ipswWatcher";
import { IPSWHardLinkManager } from "./modules/ipswHardLinkManager";
import { IPSWCleanupManager } from "./modules/ipsw-cleanup";
import { setWin } from "./utils/system";

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const ipswFolder = storeGet("ipswFolder") || app.getPath("downloads");
  state.splash = createSplashWindow();
  state.mainWindow = createMainWindow(width, height);

  ipcMain.once("renderer:ready", () => {
    state.splash?.webContents.send("splash:ready");
  });

  ipcMain.once("splash:animation-done", () => {
    state.splash?.destroy();
    state.splash = undefined;
    state.mainWindow?.show();
    state.isReady = true;
  });

  setWin(state.mainWindow);

  const defaultConfig = {
    paths: { saveDir: ipswFolder, stateDir: join(app.getPath("userData"), "ipsw-state") },
    recovery: { autoResume: false },
  };

  const savedConfig = storeGet("downloaderConfig", {});

  const savedPaths = savedConfig.paths ?? {};
  const cleanPaths: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(savedPaths)) {
    if (v) cleanPaths[k] = v as string;
  }

  const mergedConfig = {
    paths: { ...defaultConfig.paths, ...cleanPaths },
    recovery: { ...defaultConfig.recovery, ...savedConfig.recovery },
    ...(savedConfig.network && { network: savedConfig.network }),
    ...(savedConfig.scheduler && { scheduler: savedConfig.scheduler }),
    ...(savedConfig.download && { download: savedConfig.download }),
    ...(savedConfig.integrity && { integrity: savedConfig.integrity }),
  };

  state.dl = new DownloaderMain(state.mainWindow, mergedConfig, (config) => {
    s.set("downloaderConfig", config);
  });

  state.dh = new DataHandle(state.mainWindow);

  state.watcher = new IPSWWatcher(state.mainWindow, ipswFolder);
  state.linkManager = new IPSWHardLinkManager(state.mainWindow, state.watcher, state.dh, {
    watchDir: ipswFolder,
    enabled: storeGet("link_enabled", false),
    outDir: storeGet("link_out_dir", "IPSW_FILES"),
  });

  state.cleanupManager = new IPSWCleanupManager(state.dl, state.dh, {
    saveDir: ipswFolder,
    removeInvalidFile: storeGet("cleanup_remove_invalid", false),
    removeOldFile: storeGet("cleanup_remove_old", false),
    removeDuplicateFile: storeGet("cleanup_remove_duplicate", false),
  });

  loadRenderer(state.mainWindow);

  void (async () => {
    try {
      await state.dh!.loadDevices();
      await state.watcher!.start();
      await state.linkManager!.start();
      await state.cleanupManager?.start();
    } catch (error) {
      console.error("[main] Failed to initialize IPSW background services:", error);
    }
  })();
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: Error) => {
  console.error("[main] unhandledRejection:", reason);
});

app.whenReady().then(async () => {
  await init();

  setTimeout(() => {
    if (state.isReady) return;
    state.splash?.webContents.send("splash:ready");
    setTimeout(() => {
      if (state.isReady) return;
      state.splash?.destroy();
      state.splash = undefined;
      state.mainWindow?.show();
    }, 5_000);
  }, 10_000);

  globalShortcut.register("F11", () => {
    const w = state.mainWindow;
    if (w) w.setFullScreen(!w.isFullScreen());
  });

  setTimeout(() => initAutoUpdater(), 2_000);
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    await state.dl?.destroy();
    app.quit();
  }
});

app.on("before-quit", () => {
  state.dl?.destroy();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void init();
});
