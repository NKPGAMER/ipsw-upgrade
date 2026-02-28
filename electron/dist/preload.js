"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    getDiskSpace: (targetPath) => electron_1.ipcRenderer.invoke('getDiskSpace', targetPath),
    formatBytes: (bytes, decimals) => electron_1.ipcRenderer.invoke('formatBytes', bytes, decimals),
    getVersion: () => electron_1.ipcRenderer.invoke('get-version'),
    selectFolder: () => electron_1.ipcRenderer.invoke('select-folder'),
    selectFile: (options) => electron_1.ipcRenderer.invoke('select-file', options),
    getFiles: (folder) => electron_1.ipcRenderer.invoke('get:files:ipsw', folder),
    createMd5: async (filePath, options) => {
        if (options?.onProgress) {
            const progressHandler = (_, progress) => {
                options.onProgress?.(progress);
            };
            // Lắng nghe progress events
            electron_1.ipcRenderer.on('md5-progress', progressHandler);
            try {
                // Gọi main process để tính MD5
                const result = await electron_1.ipcRenderer.invoke('create-md5', filePath);
                return result;
            }
            finally {
                // Cleanup listener sau khi hoàn thành
                electron_1.ipcRenderer.removeListener('md5-progress', progressHandler);
            }
        }
        // Không có progress callback - gọi trực tiếp
        return await electron_1.ipcRenderer.invoke('create-md5', filePath);
    },
    deleteFile: (path) => electron_1.ipcRenderer.invoke('delete-file', path),
    onMessage: (callback) => {
        electron_1.ipcRenderer.on('ui-message', (_, data) => {
            callback(data);
        });
    },
    onErrorMessage: (callback) => {
        electron_1.ipcRenderer.on('ui-error-message', (_, data) => {
            callback(data);
        });
    },
    userData: {
        deleteFile: (fileName) => electron_1.ipcRenderer.invoke('user:deleteFile', fileName),
        read: (fileName) => electron_1.ipcRenderer.invoke('user:read', fileName),
        write: (fileName, data) => electron_1.ipcRenderer.invoke('user:write', fileName, data),
    }
};
const downloaderApi = {
    onDownloadComplete: (callback) => {
        electron_1.ipcRenderer.on('download-complete', (_, data) => {
            callback(data);
        });
    },
    onDownloadError: (callback) => {
        electron_1.ipcRenderer.on('download-error', (_, data) => {
            callback(data);
        });
    },
    onDownloadProgress: (callback) => {
        const subscription = (_event, progress) => {
            callback(progress);
        };
        electron_1.ipcRenderer.on('download-progress', subscription);
        return () => {
            electron_1.ipcRenderer.removeListener('download-progress', subscription);
        };
    },
    download: (request, options) => electron_1.ipcRenderer.invoke('download', request, options),
    pauseDownload: (downloadId) => electron_1.ipcRenderer.invoke('download:pause', downloadId),
    resumeDownload: (downloadId) => electron_1.ipcRenderer.invoke('download:resume', downloadId),
    cancelDownload: (downloadId) => electron_1.ipcRenderer.invoke('download:cancel', downloadId),
    getActiveDownloads: () => electron_1.ipcRenderer.invoke('download:getActiveDownloads')
};
const storeApi = {
    set: (key, value) => electron_1.ipcRenderer.invoke('store', 'set', key, value),
    get: (key) => electron_1.ipcRenderer.invoke('store', 'get', key),
    has: (key) => electron_1.ipcRenderer.invoke('store', 'has', key),
    delete: (key) => electron_1.ipcRenderer.invoke('store', 'delete', key)
};
const updaterApi = {
    onUpdateAvailable: (cb) => electron_1.ipcRenderer.on('update-available', (_, d) => cb(d)),
    onUpdateReady: (cb) => electron_1.ipcRenderer.on('update-ready', () => cb()),
    onUpdateProgress: (cb) => electron_1.ipcRenderer.on('update-progress', (_, data) => cb(data)),
    check: () => electron_1.ipcRenderer.invoke('updater:check'),
    start: () => electron_1.ipcRenderer.send('updater:start'),
    install: () => electron_1.ipcRenderer.send('updater:install')
};
electron_1.contextBridge.exposeInMainWorld('api', api);
electron_1.contextBridge.exposeInMainWorld('downloader', downloaderApi);
electron_1.contextBridge.exposeInMainWorld('store', storeApi);
electron_1.contextBridge.exposeInMainWorld('updater', updaterApi);
electron_1.contextBridge.exposeInMainWorld('ipsw_api', {
    devices: 'https://api.ipsw.me/v4/devices',
    getFirmware: 'https://api.ipsw.me/v4/device/$id?type=ipsw'
});
