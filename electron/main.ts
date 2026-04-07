import {
  app, BrowserWindow, ipcMain, dialog,
  OpenDialogOptions, FileFilter, IpcMainInvokeEvent, screen
} from "electron";
import Store from "electron-store";
import { autoUpdater, UpdateInfo } from "electron-updater";
import { join } from "path";
import { AppleDevice } from "./modules/appleDevice";
import { read, write, deleteFile as userDataDeleteFile } from "./modules/userData";
import { scanFolder, createMd5, deleteFile } from "./modules/localFile";
import { getDiskSpace, formatBytes } from "./modules/disk";
import { InternetService } from "./modules/internetService";
import { IPSWDownloader } from "./modules/downloader";
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

const SPLASH_TIMEOUT_MS  = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;
const MAX_CONCURRENT_DOWNLOADS = 3;

// ─── App State ────────────────────────────────────────────────────────────────

const store = new Store({ defaults: config.defaultAppSettings });
const internet = new InternetService();

let dl: IPSWDownloader | undefined;
let splash: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let isReady = false;

// ─── Window Factory ───────────────────────────────────────────────────────────

function createSplashWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width:  Math.round(width  * 0.42),
    height: Math.round(height * 0.40),
    frame:       false,
    alwaysOnTop: true,
    transparent: false,
    resizable:   false,
  });
  win.loadFile("splash.html");
  return win;
}

function createMainWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width:  Math.round(width  * 0.92),
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

  splash     = createSplashWindow(width, height);
  mainWindow = createMainWindow(width, height);
  dl = new IPSWDownloader(mainWindow, {
  maxConcurrentTasks: 3,
  maxConnectionsPerTask: 16,
  initialConnectionsPerTask: 4,
  chunkSize: 64 * 1024 * 1024, // MB
  // skipVerify: true,
  // adaptiveBuffer: false,
})

  loadRenderer(mainWindow);
  registerMainWindowEvents(mainWindow);
  initInternet(mainWindow);
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5173/");
    win.webContents.openDevTools({ mode: "detach" });
    try { require("electron-reloader")(module, { debug: false, watchRenderer: true }); } catch {}
  } else {
    win.loadFile("index.html");
  }
}

function registerMainWindowEvents(win: BrowserWindow): void {
  win.once("ready-to-show", () => {
    splash?.destroy();
    splash = undefined;
    win.show();
    isReady = true;
  });

  // win.on("close", (e) => {
  //   e.preventDefault();
  //   win.webContents.send("onAppClose", { taskCount: activeTasks.length });
  // });
}

async function initInternet(win: BrowserWindow): Promise<void> {
  internet.start();

  internet.on("online", () => win.webContents.send("internet-changed", true));
  internet.on("offline", () => win.webContents.send("internet-changed", false));
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  init();
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
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) init();
});

// ─── Auto Updater ─────────────────────────────────────────────────────────────

function initAutoUpdater(): void {
  autoUpdater.autoDownload        = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload?: unknown) =>
    mainWindow?.webContents.send(channel, payload);

  autoUpdater.on("update-available",  ({ version, releaseNotes }) =>
    send("update-available", { version, notes: releaseNotes }));

  autoUpdater.on("update-downloaded", () => send("update-ready"));

  autoUpdater.on("download-progress", ({ percent, transferred, total }) =>
    send("update-progress", {
      percent:     Math.round(percent),
      transferred: (transferred / 1048576).toFixed(2),
      total:       (total       / 1048576).toFixed(2),
    }));

  setTimeout(() => autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.on("updater:start",   () => autoUpdater.downloadUpdate());
ipcMain.on("updater:install", () => autoUpdater.quitAndInstall());

const handlers: IpcHandler[] = [
  // App
  ["get-version", () => app.getVersion()],
  ["app-get-online-state", () => internet.isOnline()],

  // Updater
  ["updater:check", async (): Promise<UpdateResult> => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) return { status: "no-update" };
      return { status: "update-available", info: result.updateInfo };
    } catch (error) {
      return { status: "error", error: (error as Error).message };
    }
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

  ["create-md5", (event: IpcMainInvokeEvent, filePath: string) =>
    createMd5(filePath, {
      onProgress: (progress) => event.sender.send("md5-progress", progress),
    })
  ],

  ["delete-file", (_: IpcMainInvokeEvent, filePath: string) => deleteFile(filePath)],

  // Downloads
  // add: (fw, sp) => ipcRenderer.invoke('dm-add', fw, sp),
  //   pause: (id) => ipcRenderer.invoke("dm-pause", id),
  //   resume: (id) => ipcRenderer.invoke("dm-resume", id),
  //   cancel: (id) => ipcRenderer.invoke("dm-cancel", id),
  //   getAllTask: () => ipcRenderer.invoke("dm-getAllTask"),
  //   getTask: (id) => ipcRenderer.invoke("dm-getTask", id)

  // Persistent store
  ["store", (_: IpcMainInvokeEvent, method: string, key: string, value?: any) => {
    if (!STORE_METHODS.has(method as StoreMethod)) return;
    return method === "set"
      ? (store as any).set(key, value)
      : (store as any)[method](key);
  }],

  // User data
  ["user:write",      (_: IpcMainInvokeEvent, fileName: string, data: any) => write(fileName, data)],
  ["user:read",       (_: IpcMainInvokeEvent, fileName: string)            => read(fileName)],
  ["user:deleteFile", (_: IpcMainInvokeEvent, fileName: string)            => userDataDeleteFile(fileName)],

  // Disk
  ["getDiskSpace",  (_: IpcMainInvokeEvent, targetPath?: string)              => getDiskSpace(targetPath)],
  ["formatBytes",   (_: IpcMainInvokeEvent, bytes: number, decimals: number)  => formatBytes(bytes, decimals)],

  // Close confirmation
  // ["closeAppResult", (_: IpcMainInvokeEvent, confirmed: boolean) => {
  //   if (confirmed) {
  //     mainWindow?.destroy();
  //   } else {
  //     downloadManager?.getActiveDownloads()
  //       .forEach(({ downloadId }) => downloadManager?.resumeDownload(downloadId));
  //   }
  // }],
];

handlers.forEach(([channel, handler]) => ipcMain.handle(channel, handler));