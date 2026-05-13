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
const disk_1 = require("./modules/disk");
const dataHandle_1 = require("./modules/dataHandle");
const ipswWatcher_1 = require("./modules/ipswWatcher");
const ipswHardLinkManager_1 = require("./modules/ipswHardLinkManager");
const cleanup_1 = require("./modules/ipsw/cleanup");
const downloader_1 = require("./modules/downloader");
// Config
const config_1 = __importDefault(require("./config"));
const system_1 = require("./utils/system");
// ─── Constants ────────────────────────────────────────────────────────────────
const SPLASH_TIMEOUT_MS = 10_000;
const UPDATER_INIT_DELAY = 2_000;
const UPDATER_CHECK_DELAY = 6_000;
// ─── App State ────────────────────────────────────────────────────────────────
exports.store = new electron_store_1.default({ defaults: config_1.default.defaultAppSettings });
const s = exports.store;
let dl;
let dh;
let watcher = null;
let linkManager = null;
let cleanupManager = null;
let splash;
let mainWindow;
let isReady = false;
const storeGet = (key, fallback) => s.get(key) ?? fallback;
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
    const ipswFolder = storeGet("ipswFolder") || electron_1.app.getPath('downloads');
    splash = createSplashWindow(width, height);
    mainWindow = createMainWindow(width, height);
    (0, system_1.setWin)(mainWindow);
    dl = new downloader_1.DownloaderMain(mainWindow, {
        saveDir: ipswFolder,
        turboMode: storeGet("turboMode", false),
        skipVerify: storeGet("skipVerify", false)
    });
    dh = new dataHandle_1.DataHandle(mainWindow);
    watcher = new ipswWatcher_1.IPSWWatcher(mainWindow, ipswFolder);
    linkManager = new ipswHardLinkManager_1.IPSWHardLinkManager(mainWindow, watcher, dh, {
        watchDir: ipswFolder,
        enabled: storeGet("link_enabled", false),
        outDir: storeGet("link_out_dir", "IPSW_FILES")
    });
    cleanupManager = new cleanup_1.IPSWCleanupManager(dl, dh, {
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
let updateStatus = { phase: "idle" };
function initAutoUpdater() {
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    const send = (channel, payload) => mainWindow?.webContents.send(channel, payload);
    electron_updater_1.autoUpdater.on("update-available", ({ version, releaseNotes }) => {
        updateStatus = { ...updateStatus, phase: "downloading", version, notes: releaseNotes };
        send("update-available", { version, notes: releaseNotes });
    });
    electron_updater_1.autoUpdater.on("update-not-available", () => {
        updateStatus = { ...updateStatus, phase: "no-update" };
        send("update-not-available");
    });
    electron_updater_1.autoUpdater.on("update-downloaded", () => {
        updateStatus = { ...updateStatus, phase: "ready" };
        send("update-ready");
    });
    electron_updater_1.autoUpdater.on("download-progress", ({ percent, transferred, total }) => {
        const progress = {
            percent: Math.round(percent),
            transferred: (transferred / 1048576).toFixed(2),
            total: (total / 1048576).toFixed(2),
        };
        updateStatus = { ...updateStatus, progress };
        send("update-progress", progress);
    });
    setTimeout(() => electron_updater_1.autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}
// ─── IPC Handlers ─────────────────────────────────────────────────────────────
const handlers = [
    ["app:relaunch", () => {
            electron_1.app.relaunch();
            electron_1.app.exit(0);
            return { success: true };
        }],
    // Dialogs
    ["select-folder", () => (0, system_1.selectFolder)()],
    ["select-file", (_, options) => (0, system_1.selectFile)(options)],
    // Persistent store
    ["store", (_, method, key, value) => {
            switch (method) {
                case "get": return s.get(key);
                case "set": return s.set(key, value);
                case "has": return s.has(key);
                case "delete": return s.delete(key);
            }
        }],
    // Disk
    ["getDiskSpace", (_, targetPath) => (0, disk_1.getDiskSpace)(targetPath)],
    ["formatBytes", (_, bytes, decimals) => (0, disk_1.formatBytes)(bytes, decimals)],
    // Updater
    ["updater:getStatus", () => updateStatus],
    // DataHandle
    ["dh:requestModelData", (_, identifier) => dh?.getModelDataForReact(identifier)],
    ["dh:getDeviceModelData", (_, identifier) => dh?.get(identifier)],
    ["dh:getDevices", (_, product) => dh?.getDevices(product)],
    ["dh:getModelData", (_, identifier) => dh?.getModelData(identifier)],
];
handlers.forEach(([channel, handler]) => electron_1.ipcMain.handle(channel, handler));
