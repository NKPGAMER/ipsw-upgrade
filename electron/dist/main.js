"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
// ─── Import ────────────────────────────────────────────────────────────────────
// Electron
const electron_1 = require("electron");
const electron_store_1 = __importDefault(require("electron-store"));
const electron_updater_1 = require("electron-updater");
// System
const path_1 = require("path");
// Modules
// import { AppleDevice } from "./modules/appleDevice";
const userData_1 = require("./modules/userData");
const localFile_1 = require("./modules/localFile");
const disk_1 = require("./modules/disk");
const dataHandle_1 = require("./modules/dataHandle");
const ipswWatcher_1 = require("./modules/ipswWatcher");
const ipswHardLinkManager_1 = require("./modules/ipswHardLinkManager");
const downloader_1 = require("./modules/downloader");
// Config
const config_1 = __importDefault(require("./config"));
// ─── Constants ────────────────────────────────────────────────────────────────
const STORE_METHODS = new Set(["get", "set", "has", "delete"]);
const SPLASH_TIMEOUT_MS = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;
// ─── App State ────────────────────────────────────────────────────────────────
exports.store = new electron_store_1.default({ defaults: config_1.default.defaultAppSettings });
let dl;
let dh;
let watcher = null;
let linkManager = null;
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
    dl = new downloader_1.DownloaderMain(mainWindow, {
        stateDir: (0, path_1.join)(electron_1.app.getPath("userData"), "ipsw-state"),
        config: {
            turboMode: true
        }
    });
    dh = new dataHandle_1.DataHandle(mainWindow);
    const ipswFolder = exports.store.get("ipswFolder") ?? config_1.default.defaultAppSettings.ipswFolder;
    const isEnabled = exports.store.get("enable") ?? true;
    watcher = new ipswWatcher_1.IPSWWatcher(mainWindow, ipswFolder);
    linkManager = new ipswHardLinkManager_1.IPSWHardLinkManager(mainWindow, watcher, dh, {
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
        }
        catch (error) {
            console.error("[main] Failed to initialize IPSW background services:", error);
        }
    })();
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
        win.loadFile("dist/index.html");
    }
}
function registerMainWindowEvents(win) {
    win.once("ready-to-show", () => {
        splash?.destroy();
        splash = undefined;
        win.show();
        isReady = true;
    });
}
// ─── App Lifecycle ────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    await init();
    // new AppleDevice(mainWindow);
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
    if (process.platform !== "darwin") {
        void dl?.destroy();
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        void init();
});
electron_1.ipcMain.handle("ipsw:sync-link-config", async (_event, savePath, enabled) => {
    await linkManager?.updateConfig({ savePath, enabled });
    return { success: true };
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
const handlers = [
    ["app:relaunch", async () => {
            electron_1.app.relaunch();
            electron_1.app.exit(0);
            return { success: true };
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
    ["delete-file", (_, filePath) => (0, localFile_1.deleteFile)(filePath)],
    // Persistent store
    ["store", (_, method, key, value) => {
            if (!STORE_METHODS.has(method))
                return;
            return method === "set"
                ? exports.store.set(key, value)
                : exports.store[method](key);
        }],
    // User data
    ["user:write", (_, fileName, data) => (0, userData_1.write)(fileName, data)],
    ["user:read", (_, fileName) => (0, userData_1.read)(fileName)],
    ["user:deleteFile", (_, fileName) => (0, userData_1.deleteFile)(fileName)],
    // Disk
    ["getDiskSpace", (_, targetPath) => (0, disk_1.getDiskSpace)(targetPath)],
    ["formatBytes", (_, bytes, decimals) => (0, disk_1.formatBytes)(bytes, decimals)],
    ["dh:requestModelData", (_, identifier) => dh?.getModelDataForReact(identifier)],
    ["dh:getDeviceModelData", async (_, identifier) => dh?.get(identifier)],
    ["dh:getDevices", (_, product) => dh?.getDevices(product)],
    ["dh:getModelData", (_, identifier) => dh?.getModelData(identifier)]
];
handlers.forEach(([channel, handler]) => electron_1.ipcMain.handle(channel, handler));
