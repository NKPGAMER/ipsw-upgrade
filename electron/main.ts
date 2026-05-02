// ─── Import ────────────────────────────────────────────────────────────────────
// Electron
import {
  app, BrowserWindow, ipcMain, dialog,
  OpenDialogOptions, FileFilter, IpcMainInvokeEvent, screen
} from "electron";
import Store from "electron-store";
import { autoUpdater, UpdateInfo } from "electron-updater";
// System
import { join } from "path";
// Modules
import { AppleDevice } from "./modules/appleDevice";
import { read, write, deleteFile as userDataDeleteFile } from "./modules/userData";
import { scanFolder, deleteFile } from "./modules/localFile";
import { getDiskSpace, formatBytes } from "./modules/disk";
import { DataHandle } from "./modules/dataHandle";
import { IPSWWatcher } from "./modules/ipswWatcher";
import { IPSWHardLinkManager } from "./modules/ipswHardLinkManager";
import { DownloaderMain } from "./modules/downloader";
// Config
import config from "./config";
// ─── Types ────────────────────────────────────────────────────────────────────

interface UpdateResult {
  status: "no-update" | "update-available" | "error";
  info?: UpdateInfo;
  error?: string;
}

type IpcHandler = [string, (event: IpcMainInvokeEvent, ...args: any[]) => any];

// ─── Constants ────────────────────────────────────────────────────────────────

const STORE_METHODS = new Set(["get", "set", "has", "delete"] as const);
type StoreMethod = "get" | "set" | "has" | "delete";

const SPLASH_TIMEOUT_MS = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;

// ─── App State ────────────────────────────────────────────────────────────────

export const store = new Store({ defaults: config.defaultAppSettings });

let dl: DownloaderMain | undefined;
let dh: DataHandle | undefined;
let watcher: IPSWWatcher | null = null;
let linkManager: IPSWHardLinkManager | null = null;
let splash: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let isReady = false;

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
  splash = createSplashWindow(width, height);
  mainWindow = createMainWindow(width, height);

  dl = new DownloaderMain(mainWindow, {
    stateDir: ".ipsw-state",
    config: {
      maxConcurrentTasks: 3,
      maxConnectionsPerTask: 16,
      initialConnectionsPerTask: 4,
      chunkSize: 32 * 1024 * 1024,
    }
  });

  dh = new DataHandle(mainWindow);
  const ipswFolder = (store as any).get("ipswFolder") ?? config.defaultAppSettings.ipswFolder;
  const isEnabled = (store as any).get("enable") ?? true;
  watcher = new IPSWWatcher(mainWindow, ipswFolder);
  linkManager = new IPSWHardLinkManager(mainWindow, watcher, dh, {
    savePath: ipswFolder,
    enabled: isEnabled,
  });

  loadRenderer(mainWindow);
  registerMainWindowEvents(mainWindow);

  void (async () => {
    try {
      await dh.loadDevices();
      await watcher.start();
      await linkManager.start();
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
  new AppleDevice(mainWindow);

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

ipcMain.handle("ipsw:sync-link-config", async (_event, savePath: string, enabled: boolean) => {
  await linkManager?.updateConfig({ savePath, enabled });
  return { success: true };
});

// ─── Auto Updater ─────────────────────────────────────────────────────────────

function initAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload?: unknown) =>
    mainWindow?.webContents.send(channel, payload);

  autoUpdater.on("update-available", ({ version, releaseNotes }) =>
    send("update-available", { version, notes: releaseNotes }));

  autoUpdater.on("update-downloaded", () => send("update-ready"));

  autoUpdater.on("download-progress", ({ percent, transferred, total }) =>
    send("update-progress", {
      percent: Math.round(percent),
      transferred: (transferred / 1048576).toFixed(2),
      total: (total / 1048576).toFixed(2),
    }));

  setTimeout(() => autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

const handlers: IpcHandler[] = [
  ["app:relaunch", async () => {
    app.relaunch();
    app.exit(0);
    return { success: true };
  }],

  // Dialogs
  ["select-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return canceled ? null : filePaths[0];
  }],

  ["select-file", async (_: IpcMainInvokeEvent, filters?: FileFilter[]) => {
    const options: OpenDialogOptions = { properties: ["openFile"] };
    if (filters?.length) options.filters = filters;
    const { canceled, filePaths } = await dialog.showOpenDialog(options);
    return canceled ? null : filePaths[0];
  }],

  // Files
  ["get:files:ipsw", async (_: IpcMainInvokeEvent, folder: string) => {
    try {
      return scanFolder(folder);
    } catch (error: any) {
      throw new Error(`Failed to scan folder: ${error.message}`);
    }
  }],

  ["delete-file", (_: IpcMainInvokeEvent, filePath: string) => deleteFile(filePath)],

  // Persistent store
  ["store", (_: IpcMainInvokeEvent, method: string, key: string, value?: any) => {
    if (!STORE_METHODS.has(method as StoreMethod)) return;
    return method === "set"
      ? (store as any).set(key, value)
      : (store as any)[method](key);
  }],

  // User data
  ["user:write", (_: IpcMainInvokeEvent, fileName: string, data: any) => write(fileName, data)],
  ["user:read", (_: IpcMainInvokeEvent, fileName: string) => read(fileName)],
  ["user:deleteFile", (_: IpcMainInvokeEvent, fileName: string) => userDataDeleteFile(fileName)],

  // Disk
  ["getDiskSpace", (_: IpcMainInvokeEvent, targetPath?: string) => getDiskSpace(targetPath)],
  ["formatBytes", (_: IpcMainInvokeEvent, bytes: number, decimals: number) => formatBytes(bytes, decimals)],

  ["dh:requestModelData", (_, identifier) => dh?.getModelDataForReact(identifier)],
  ["dh:getDevices", (_, product) => dh?.getDevices(product)],
  ["dh:getModelData", (_, identifier) => dh?.getModelData(identifier)]
];

handlers.forEach(([channel, handler]) => ipcMain.handle(channel, handler))