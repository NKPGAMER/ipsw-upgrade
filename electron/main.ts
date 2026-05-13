// ─── Import ────────────────────────────────────────────────────────────────────
// Electron
import {
  app, BrowserWindow, ipcMain, dialog,
  OpenDialogOptions, FileFilter, IpcMainInvokeEvent, screen
} from "electron";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";
// System
import { join } from "path";
// Modules
import { getDiskSpace, formatBytes } from "./modules/disk";
import { DataHandle } from "./modules/dataHandle";
import { IPSWWatcher } from "./modules/ipswWatcher";
import { IPSWHardLinkManager } from "./modules/ipswHardLinkManager";
import { IPSWCleanupManager } from "./modules/ipsw/cleanup";
import { DownloaderMain } from "./modules/downloader";
// Config
import config from "./config";
import { setWin, selectFolder, selectFile } from "./utils/system";

// ─── Types ────────────────────────────────────────────────────────────────────

type IpcHandler = [string, (event: IpcMainInvokeEvent, ...args: any[]) => any];

// ─── Constants ────────────────────────────────────────────────────────────────

const SPLASH_TIMEOUT_MS = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;

// ─── App State ────────────────────────────────────────────────────────────────

export const store = new Store({ defaults: config.defaultAppSettings });

const s = store as unknown as Record<string, any> & { get: (k: string) => any; set: (k: string, v: any) => void; has: (k: string) => boolean; delete: (k: string) => void };

let dl: DownloaderMain | undefined;
let dh: DataHandle | undefined;
let watcher: IPSWWatcher | null = null;
let linkManager: IPSWHardLinkManager | null = null;
let cleanupManager: IPSWCleanupManager | null = null;
let splash: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let isReady = false;

const storeGet = (key: string, fallback?: any) => s.get(key) ?? fallback;

// ─── Window Factory ───────────────────────────────────────────────────────────

function createSplashWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width: Math.round(width * 0.42),
    height: Math.round(height * 0.40),
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false,
  });
  win.loadFile("splash.html");
  return win;
}

function createMainWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width: Math.round(width * 0.92),
    height: Math.round(height * 0.95),
    show: false,
    transparent: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--app-version=${app.getVersion()}`
      ]
    },
  });
  win.setMenu(null);
  return win;
}

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const ipswFolder = storeGet("ipswFolder") || app.getPath('downloads');
  splash = createSplashWindow(width, height);
  mainWindow = createMainWindow(width, height);

  setWin(mainWindow);

  dl = new DownloaderMain(mainWindow, {
    saveDir: ipswFolder,
    turboMode: storeGet("turboMode", false),
    skipVerify: storeGet("skipVerify", false)
  });

  dh = new DataHandle(mainWindow);

  watcher = new IPSWWatcher(mainWindow, ipswFolder);
  linkManager = new IPSWHardLinkManager(mainWindow, watcher, dh, {
    watchDir: ipswFolder,
    enabled: storeGet("link_enabled", false),
    outDir: storeGet("link_out_dir", "IPSW_FILES")
  });

  cleanupManager = new IPSWCleanupManager(dl, dh, {
    saveDir: ipswFolder,
    removeInvalidFile: storeGet("cleanup_remove_invalid", false),
    removeOldFile: storeGet("cleanup_remove_old", false),
    removeDuplicateFile: storeGet("cleanup_remove_duplicate", false),
  });

  loadRenderer(mainWindow);
  registerMainWindowEvents(mainWindow);

  void (async () => {
    try {
      await dh.loadDevices();
      await watcher.start();
      await linkManager.start();
      await cleanupManager?.start();
    } catch (error) {
      console.error("[main] Failed to initialize IPSW background services:", error);
    }
  })();
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5173/");
    win.webContents.openDevTools({ mode: "detach" });
    try { require("electron-reloader")(module, { debug: false, watchRenderer: true }); } catch { }
  } else {
    win.loadFile("dist/index.html");
  }
}

function registerMainWindowEvents(win: BrowserWindow): void {
  win.once("ready-to-show", () => {
    splash?.destroy();
    splash = undefined;
    win.show();
    isReady = true;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await init();

  // Fallback: show main window if `ready-to-show` never fires
  setTimeout(() => {
    if (isReady) return;
    splash?.destroy();
    splash = undefined;
    mainWindow?.show();
  }, SPLASH_TIMEOUT_MS);

  setTimeout(() => initAutoUpdater(), UPDATER_INIT_DELAY);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void dl?.destroy();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void init();
});

// ─── Auto Updater ─────────────────────────────────────────────────────────────

interface UpdateStatus {
  phase: "idle" | "downloading" | "ready" | "no-update";
  version?: string;
  notes?: any;
  progress?: { percent: number; transferred: string; total: string };
}

let updateStatus: UpdateStatus = { phase: "idle" };

function initAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload?: unknown) =>
    mainWindow?.webContents.send(channel, payload);

  autoUpdater.on("update-available", ({ version, releaseNotes }) => {
    updateStatus = { ...updateStatus, phase: "downloading", version, notes: releaseNotes };
    send("update-available", { version, notes: releaseNotes });
  });

  autoUpdater.on("update-not-available", () => {
    updateStatus = { ...updateStatus, phase: "no-update" };
    send("update-not-available");
  });

  autoUpdater.on("update-downloaded", () => {
    updateStatus = { ...updateStatus, phase: "ready" };
    send("update-ready");
  });

  autoUpdater.on("download-progress", ({ percent, transferred, total }) => {
    const progress = {
      percent: Math.round(percent),
      transferred: (transferred / 1048576).toFixed(2),
      total: (total / 1048576).toFixed(2),
    };
    updateStatus = { ...updateStatus, progress };
    send("update-progress", progress);
  });

  setTimeout(() => autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

const handlers: IpcHandler[] = [
  ["app:relaunch", () => {
    app.relaunch();
    app.exit(0);
    return { success: true };
  }],

  // Dialogs
  ["select-folder", () => selectFolder()],

  ["select-file", (_, options?: OpenDialogOptions) => selectFile(options)],

  // Persistent store
  ["store", (_, method: string, key: string, value?: any) => {
    switch (method) {
      case "get":    return s.get(key);
      case "set":    return s.set(key, value);
      case "has":    return s.has(key);
      case "delete": return s.delete(key);
    }
  }],

  // Disk
  ["getDiskSpace", (_, targetPath?: string) => getDiskSpace(targetPath)],
  ["formatBytes", (_, bytes: number, decimals: number) => formatBytes(bytes, decimals)],

  // Updater
  ["updater:getStatus", () => updateStatus],

  // DataHandle
  ["dh:requestModelData", (_, identifier) => dh?.getModelDataForReact(identifier)],
  ["dh:getDeviceModelData", (_, identifier) => dh?.get(identifier)],
  ["dh:getDevices", (_, product) => dh?.getDevices(product)],
  ["dh:getModelData", (_, identifier) => dh?.getModelData(identifier)],
];

handlers.forEach(([channel, handler]) => ipcMain.handle(channel, handler));
