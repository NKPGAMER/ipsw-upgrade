"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_store_1 = __importDefault(require("electron-store"));
const electron_updater_1 = require("electron-updater");
const path_1 = require("path");
const appleDevice_1 = require("./modules/appleDevice");
const userData_1 = require("./modules/userData");
const localFile_1 = require("./modules/localFile");
const disk_1 = require("./modules/disk");
const internetService_1 = require("./modules/internetService");
const downloader_1 = require("./modules/downloader");
const config_1 = __importDefault(require("./config"));
// ─── Constants ────────────────────────────────────────────────────────────────
const STORE_METHODS = new Set(["get", "set", "has", "delete"]);
const SPLASH_TIMEOUT_MS = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;
const MAX_CONCURRENT_DOWNLOADS = 3;
// ─── App State ────────────────────────────────────────────────────────────────
const store = new electron_store_1.default({ defaults: config_1.default.defaultAppSettings });
const internet = new internetService_1.InternetService();
let dl;
let splash;
let mainWindow;
let isReady = false;
// ─── Window Factory ───────────────────────────────────────────────────────────
function createSplashWindow(width, height) {
    const win = new electron_1.BrowserWindow({
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
function createMainWindow(width, height) {
    const win = new electron_1.BrowserWindow({
        width: Math.round(width * 0.92),
        height: Math.round(height * 0.95),
        show: false,
        transparent: false,
        webPreferences: {
            preload: (0, path_1.join)(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            additionalArguments: [
                `--app-version=${electron_1.app.getVersion()}`
            ]
        },
    });
    win.setMenu(null);
    return win;
}
// ─── Initialisation ───────────────────────────────────────────────────────────
async function init() {
    const { width, height } = electron_1.screen.getPrimaryDisplay().workAreaSize;
    splash = createSplashWindow(width, height);
    mainWindow = createMainWindow(width, height);
    dl = new downloader_1.IPSWDownloader(mainWindow, {
        maxConcurrentTasks: 3,
        maxConnectionsPerTask: 16,
        initialConnectionsPerTask: 4,
        chunkSize: 64 * 1024 * 1024, // MB
        skipVerify: true,
        adaptiveBuffer: false,
    });
    loadRenderer(mainWindow);
    registerMainWindowEvents(mainWindow);
    initInternet(mainWindow);
}
function loadRenderer(win) {
    if (process.env.VITE_DEV_SERVER_URL || !electron_1.app.isPackaged) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5173/");
        win.webContents.openDevTools({ mode: "detach" });
        try {
            require("electron-reloader")(module, { debug: false, watchRenderer: true });
        }
        catch { }
    }
    else {
        win.loadFile("index.html");
    }
}
function registerMainWindowEvents(win) {
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
async function initInternet(win) {
    internet.start();
    internet.on("online", () => win.webContents.send("internet-changed", true));
    internet.on("offline", () => win.webContents.send("internet-changed", false));
}
// ─── App Lifecycle ────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    init();
    new appleDevice_1.AppleDevice(mainWindow);
    // Fallback: show main window if `ready-to-show` never fires
    setTimeout(() => {
        if (isReady)
            return;
        splash?.destroy();
        splash = undefined;
        mainWindow?.show();
    }, SPLASH_TIMEOUT_MS);
    setTimeout(() => initAutoUpdater(), UPDATER_INIT_DELAY);
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        init();
});
// ─── Auto Updater ─────────────────────────────────────────────────────────────
function initAutoUpdater() {
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    const send = (channel, payload) => mainWindow?.webContents.send(channel, payload);
    electron_updater_1.autoUpdater.on("update-available", ({ version, releaseNotes }) => send("update-available", { version, notes: releaseNotes }));
    electron_updater_1.autoUpdater.on("update-downloaded", () => send("update-ready"));
    electron_updater_1.autoUpdater.on("download-progress", ({ percent, transferred, total }) => send("update-progress", {
        percent: Math.round(percent),
        transferred: (transferred / 1048576).toFixed(2),
        total: (total / 1048576).toFixed(2),
    }));
    setTimeout(() => electron_updater_1.autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}
// ─── IPC Handlers ─────────────────────────────────────────────────────────────
electron_1.ipcMain.on("updater:start", () => electron_updater_1.autoUpdater.downloadUpdate());
electron_1.ipcMain.on("updater:install", () => electron_updater_1.autoUpdater.quitAndInstall());
const handlers = [
    // App
    ["get-version", () => electron_1.app.getVersion()],
    ["app-get-online-state", () => internet.isOnline()],
    // Updater
    ["updater:check", async () => {
            try {
                const result = await electron_updater_1.autoUpdater.checkForUpdates();
                if (!result?.isUpdateAvailable)
                    return { status: "no-update" };
                return { status: "update-available", info: result.updateInfo };
            }
            catch (error) {
                return { status: "error", error: error.message };
            }
        }],
    // Dialogs
    ["select-folder", async () => {
            const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({ properties: ["openDirectory"] });
            return canceled ? null : filePaths[0];
        }],
    ["select-file", async (_, filters) => {
            const options = { properties: ["openFile"] };
            if (filters?.length)
                options.filters = filters;
            const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(options);
            return canceled ? null : filePaths[0];
        }],
    // Files
    ["get:files:ipsw", async (_, folder) => {
            try {
                return (0, localFile_1.scanFolder)(folder);
            }
            catch (error) {
                throw new Error(`Failed to scan folder: ${error.message}`);
            }
        }],
    ["create-md5", (event, filePath) => (0, localFile_1.createMd5)(filePath, {
            onProgress: (progress) => event.sender.send("md5-progress", progress),
        })
    ],
    ["delete-file", (_, filePath) => (0, localFile_1.deleteFile)(filePath)],
    // Downloads
    // add: (fw, sp) => ipcRenderer.invoke('dm-add', fw, sp),
    //   pause: (id) => ipcRenderer.invoke("dm-pause", id),
    //   resume: (id) => ipcRenderer.invoke("dm-resume", id),
    //   cancel: (id) => ipcRenderer.invoke("dm-cancel", id),
    //   getAllTask: () => ipcRenderer.invoke("dm-getAllTask"),
    //   getTask: (id) => ipcRenderer.invoke("dm-getTask", id)
    // Persistent store
    ["store", (_, method, key, value) => {
            if (!STORE_METHODS.has(method))
                return;
            return method === "set"
                ? store.set(key, value)
                : store[method](key);
        }],
    // User data
    ["user:write", (_, fileName, data) => (0, userData_1.write)(fileName, data)],
    ["user:read", (_, fileName) => (0, userData_1.read)(fileName)],
    ["user:deleteFile", (_, fileName) => (0, userData_1.deleteFile)(fileName)],
    // Disk
    ["getDiskSpace", (_, targetPath) => (0, disk_1.getDiskSpace)(targetPath)],
    ["formatBytes", (_, bytes, decimals) => (0, disk_1.formatBytes)(bytes, decimals)],
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
handlers.forEach(([channel, handler]) => electron_1.ipcMain.handle(channel, handler));
