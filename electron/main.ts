import { app, BrowserWindow, ipcMain, dialog, OpenDialogOptions, FileFilter, IpcMainInvokeEvent, screen } from "electron";
import Store from "electron-store";;
import { autoUpdater, UpdateInfo } from "electron-updater"
import { join } from "path";
import { promises } from "fs";
import { read, write, deleteFile } from "./modules/userData";
import { scanFolder, createMd5 } from "./modules/localFile";
import { DownloadManager, DownloadOptions, DownloadRequest } from "./modules/download";
import { getDiskSpace, formatBytes } from "./modules/disk";

import config from "./config";

interface updateInfo {
  status: "no-update" | "update-available" | "error";
  info?: UpdateInfo;
  error?: string;
}

const store = new Store({
  defaults: config.defaultAppSettings
});

let mainWindow: BrowserWindow | undefined;
let splash: BrowserWindow | undefined;
let downloadManager: DownloadManager | undefined;

const handle = [
  ["get-version", () => app.getVersion()],
  ["updater:check", async (): Promise<updateInfo> => {
    try {
      const result = await autoUpdater.checkForUpdates();

      if (!result || !result.isUpdateAvailable) return { status: "no-update" };

      return { status: "update-available", info: result.updateInfo };
    } catch (error) {
      return { status: "error", error: (error as Error).message }
    }
  }],

  ["select-folder", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (res.canceled) return null;
    return res.filePaths[0];
  }],

  ["select-file", async (_: IpcMainInvokeEvent, options?: FileFilter[]) => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile']
    }
    if (options && options.length > 0) {
      dialogOptions.filters = [...options]
    }
    const result = await dialog.showOpenDialog(dialogOptions);
    if (result.canceled) return null;
    return result.filePaths[0];
  }],

  ["get:files:ipsw", async (_: IpcMainInvokeEvent, folder: string) => {
    try {
      return scanFolder(folder);
    } catch (error: any) {
      console.error('Error scanning folder:', error);
      throw new Error(`Failed to scan folder: ${error.message}`);
    }
  }],

  ["createMd5", (_: IpcMainInvokeEvent, filePath: string, options?: Md5Options) => createMd5(filePath, options)],
  ['create-md5', async (event: IpcMainInvokeEvent, filePath: string) => {
    return await createMd5(filePath, {
      onProgress: (progress) => {
        event.sender.send('md5-progress', progress);
      }
    });
  }],

  ["download", async (_: IpcMainInvokeEvent, request: DownloadRequest, options: DownloadOptions) => await downloadManager?.download(request, options)],
  ["download:pause", (_: IpcMainInvokeEvent, id: string) => { downloadManager?.pauseDownload(id) }],
  ["download:resume", (_: IpcMainInvokeEvent, id: string) => { downloadManager?.resumeDownload(id) }],
  ["download:cancel", (_: IpcMainInvokeEvent, id: string) => { downloadManager?.cancelDownload(id) }],
  ["download:getActiveDownloads", (_: IpcMainInvokeEvent) => downloadManager?.getActiveDownloads()],

  ["delete-file", async (_: IpcMainInvokeEvent, filePath: string) => {
    try {
      await promises.unlink(filePath);
      return { success: true };
    } catch (err: any) {
      console.error('Delete file error:', err);
      return { success: false, error: err.message };
    }
  }],

  ['store', (_: IpcMainInvokeEvent, method: string, key: string, value?: any) => {
    try {
      if (method === 'get') {
        return (store as any)[method](key);
      } else if (method === 'set') {
        (store as any)[method](key, value);
        return true;
      } else if (method === 'has') {
        return (store as any)[method](key);
      } else if (method === 'delete') {
        (store as any)[method](key);
        return true;
      }
    } catch (error: any) {
      console.error('Store operation error:', error);
      throw new Error(`Store operation failed: ${error.message}`);
    }
  }],

  ["user:write", async (_: IpcMainInvokeEvent, fileName: string, data: any) => {
    try {
      return await write(fileName, data);
    } catch (error: any) {
      console.error('User write error:', error);
      return null;
    }
  }],

  ["user:read", async (_: IpcMainInvokeEvent, fileName: string) => {
    try {
      return await read(fileName);
    } catch (error: any) {
      console.error('User read error:', error);
      return null;
    }
  }],

  ["user:deleteFile", (_: IpcMainInvokeEvent, fileName: string) => {
    try {
      return deleteFile(fileName);
    } catch (error: any) {
      console.error('User delete file error:', error);
      return false;
    }
  }],

  ["getDiskSpace", (_: IpcMainInvokeEvent, targetPath?: string) => getDiskSpace(targetPath)],
  ["formatBytes", (_: IpcMainInvokeEvent, bytes: number, decimals: number) => formatBytes(bytes, decimals)],
  ["app:close", (_: IpcMainInvokeEvent, destroy?: boolean) => destroy ? mainWindow?.destroy() : mainWindow?.close()],
  ["closeAppResult", (_: IpcMainInvokeEvent, result: boolean) => {
    if (result) {
      mainWindow?.destroy()
    } else {
      if (!downloadManager) return;
      for (const task of downloadManager.getActiveDownloads()) {
        downloadManager.resumeDownload(task.downloadId);
      }
    }
  }]
];

function createWindow() {
  // Splash
  splash = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false
  });

  splash.loadFile("splash.html");

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.round(width * 0.92),
    height: Math.round(height * 0.95),
    show: false,
    transparent: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    splash?.destroy();
    splash = undefined;
    mainWindow?.show();
  });

  downloadManager = new DownloadManager(mainWindow, 3);

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  mainWindow.on('close', (e) => {
    if (!downloadManager) return;
    const downloadTask = downloadManager.getActiveDownloads();

    if (downloadTask.length > 0) {
      e.preventDefault();

      for (const task of downloadTask) {
        downloadManager.pauseDownload(task.downloadId);
      }
      mainWindow?.webContents.send('onAppClose', {
        taskCount: downloadTask.length
      })
    }
  });


  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    try {
      require('electron-reloader')(module, {
        debug: false,
        watchRenderer: true
      })
    } catch { }
  } else {
    mainWindow.setMenu(null);
  }
}

app.whenReady().then(() => {
  createWindow();
  
  setTimeout(() => initAutoUpdater(), 2000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.exit()
  }
});

// ============================================
// Check Update
// ============================================

function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update-available", {
    version: info.version,
    notes: info.releaseNotes
  });
});

autoUpdater.on("update-downloaded", () => {
  mainWindow?.webContents.send("update-ready");
});

autoUpdater.on("download-progress", (progress) => {
  const percent = Math.round(progress.percent);
  const transferred = (progress.transferred / 1024 / 1024).toFixed(2);
  const total = (progress.total / 1024 / 1024).toFixed(2);

  mainWindow?.webContents.send("update-progress", { percent, transferred, total });
});

setTimeout(() => autoUpdater.checkForUpdates(), 6000)
}

// ============================================
// IPC Handlers
// ============================================

// Updater
ipcMain.on("updater:start", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on("updater:install", () => {
  autoUpdater.quitAndInstall();
});

handle.forEach(h => ipcMain.handle(h[0] as string, h[1] as () => any));

