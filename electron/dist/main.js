"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_store_1 = __importDefault(require("electron-store"));
;
const electron_updater_1 = require("electron-updater");
const path_1 = require("path");
const fs_1 = require("fs");
const userData_1 = require("./modules/userData");
const localFile_1 = require("./modules/localFile");
const download_1 = require("./modules/download");
const disk_1 = require("./modules/disk");
const config_1 = __importDefault(require("./config"));
const store = new electron_store_1.default({
    defaults: config_1.default.defaultAppSettings
});
const handle = [
    ["get-version", () => electron_1.app.getVersion()],
    ["updater:check", async () => {
            try {
                const result = await electron_updater_1.autoUpdater.checkForUpdates();
                if (!result || !result.isUpdateAvailable)
                    return { status: "no-update" };
                return { status: "update-available", info: result.updateInfo };
            }
            catch (error) {
                return { status: "error", error: error.message };
            }
        }],
    ["select-folder", async () => {
            const res = await electron_1.dialog.showOpenDialog({ properties: ["openDirectory"] });
            if (res.canceled)
                return null;
            return res.filePaths[0];
        }],
    ["select-file", async (_, options) => {
            const dialogOptions = {
                properties: ['openFile']
            };
            if (options && options.length > 0) {
                dialogOptions.filters = [...options];
            }
            const result = await electron_1.dialog.showOpenDialog(dialogOptions);
            if (result.canceled)
                return null;
            return result.filePaths[0];
        }],
    ["get:files:ipsw", async (_, folder) => {
            try {
                return (0, localFile_1.scanFolder)(folder);
            }
            catch (error) {
                console.error('Error scanning folder:', error);
                throw new Error(`Failed to scan folder: ${error.message}`);
            }
        }],
    ["createMd5", (_, filePath, options) => (0, localFile_1.createMd5)(filePath, options)],
    ['create-md5', async (event, filePath) => {
            return await (0, localFile_1.createMd5)(filePath, {
                onProgress: (progress) => {
                    event.sender.send('md5-progress', progress);
                }
            });
        }],
    ["download", async (_, request, options) => await downloadManager?.download(request, options)],
    ["download:pause", (_, id) => { downloadManager?.pauseDownload(id); }],
    ["download:resume", (_, id) => { downloadManager?.resumeDownload(id); }],
    ["download:cancel", (_, id) => { downloadManager?.cancelDownload(id); }],
    ["download:getActiveDownloads", (_) => downloadManager?.getActiveDownloads()],
    ["delete-file", async (_, filePath) => {
            try {
                await fs_1.promises.unlink(filePath);
                return { success: true };
            }
            catch (err) {
                console.error('Delete file error:', err);
                return { success: false, error: err.message };
            }
        }],
    ['store', (_, method, key, value) => {
            try {
                if (method === 'get') {
                    return store[method](key);
                }
                else if (method === 'set') {
                    store[method](key, value);
                    return true;
                }
                else if (method === 'has') {
                    return store[method](key);
                }
                else if (method === 'delete') {
                    store[method](key);
                    return true;
                }
            }
            catch (error) {
                console.error('Store operation error:', error);
                throw new Error(`Store operation failed: ${error.message}`);
            }
        }],
    ["user:write", async (_, fileName, data) => {
            try {
                return await (0, userData_1.write)(fileName, data);
            }
            catch (error) {
                console.error('User write error:', error);
                return null;
            }
        }],
    ["user:read", async (_, fileName) => {
            try {
                return await (0, userData_1.read)(fileName);
            }
            catch (error) {
                console.error('User read error:', error);
                return null;
            }
        }],
    ["user:deleteFile", (_, fileName) => {
            try {
                return (0, userData_1.deleteFile)(fileName);
            }
            catch (error) {
                console.error('User delete file error:', error);
                return false;
            }
        }],
    ["getDiskSpace", (_, targetPath) => (0, disk_1.getDiskSpace)(targetPath)],
    ["formatBytes", (_, bytes, decimals) => (0, disk_1.formatBytes)(bytes, decimals)]
];
let mainWindow;
let splash;
let downloadManager;
function createWindow() {
    // Splash
    splash = new electron_1.BrowserWindow({
        width: 400,
        height: 200,
        frame: false,
        alwaysOnTop: true,
        transparent: false,
        resizable: false
    });
    splash.loadFile("splash.html");
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 790,
        show: false,
        transparent: false,
        webPreferences: {
            preload: (0, path_1.join)(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile("index.html");
    mainWindow.once("ready-to-show", () => {
        splash?.close();
        splash = undefined;
        mainWindow?.show();
    });
    downloadManager = new download_1.DownloadManager(mainWindow, 3);
    mainWindow.on('closed', () => {
        mainWindow = undefined;
    });
    mainWindow.on('close', async (e) => {
        if (!downloadManager)
            return;
        const task = downloadManager.getActiveDownloads().length;
        if (task > 0) {
            e.preventDefault();
            for (const task of downloadManager.getActiveDownloads()) {
                downloadManager.pauseDownload(task.downloadId);
            }
            const result = await electron_1.dialog.showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['Hủy', 'Thoát'],
                title: 'Xác nhận',
                message: `Hiện đang có ${task} tệp đang tải. Bạn có chắc chắn muốn thoát?`
            });
            if (result.response === 1) {
                mainWindow?.destroy();
            }
            else {
                for (const task of downloadManager.getActiveDownloads()) {
                    downloadManager.resumeDownload(task.downloadId);
                }
            }
        }
    });
    if (!electron_1.app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        try {
            require('electron-reloader')(module, {
                debug: false,
                watchRenderer: true
            });
        }
        catch { }
    }
    else {
        mainWindow.setMenu(null);
    }
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_updater_1.autoUpdater.checkForUpdates();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        electron_1.app.exit();
    }
});
// ============================================
// Check Update
// ============================================
electron_updater_1.autoUpdater.autoDownload = false;
electron_updater_1.autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
        version: info.version,
        notes: info.releaseNotes
    });
});
electron_updater_1.autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-ready");
});
electron_updater_1.autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    const transferred = (progress.transferred / 1024 / 1024).toFixed(2);
    const total = (progress.total / 1024 / 1024).toFixed(2);
    mainWindow?.webContents.send("update-progress", { percent, transferred, total });
});
// ============================================
// IPC Handlers
// ============================================
// Updater
electron_1.ipcMain.on("updater:start", () => {
    electron_updater_1.autoUpdater.downloadUpdate();
});
electron_1.ipcMain.on("updater:install", () => {
    electron_updater_1.autoUpdater.quitAndInstall();
});
handle.forEach(h => electron_1.ipcMain.handle(h[0], h[1]));
