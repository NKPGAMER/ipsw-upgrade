"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
function listen(channel, cb) {
    const handler = (_, ...args) => cb(...args);
    electron_1.ipcRenderer.on(channel, handler);
    return {
        unsubscribe: () => electron_1.ipcRenderer.removeListener(channel, handler)
    };
}
const versionArg = process.argv.find(arg => arg.startsWith('--app-version'));
const api = {
    getDiskSpace: (targetPath) => electron_1.ipcRenderer.invoke('getDiskSpace', targetPath),
    formatBytes: (bytes, decimals) => electron_1.ipcRenderer.invoke('formatBytes', bytes, decimals),
    getVersion: versionArg ? versionArg.split("=")[1] : "unknown",
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
    getOnlineState: () => electron_1.ipcRenderer.invoke('app-get-online-state'),
    onInternetChanged(callback) {
        electron_1.ipcRenderer.on('internet-changed', (_, online) => {
            callback(online);
        });
    },
    onAppClose(callback) {
        electron_1.ipcRenderer.on('onAppClose', (_, event) => {
            callback(event);
        });
    },
    sendAppCloseResult(result) {
        electron_1.ipcRenderer.invoke('closeAppResult', result);
    },
    userData: {
        deleteFile: (fileName) => electron_1.ipcRenderer.invoke('user:deleteFile', fileName),
        read: (fileName) => electron_1.ipcRenderer.invoke('user:read', fileName),
        write: (fileName, data) => electron_1.ipcRenderer.invoke('user:write', fileName, data),
    },
    file: {
        getFiles: () => electron_1.ipcRenderer.invoke("ipsw:get-files"),
        delete: (t) => electron_1.ipcRenderer.invoke("ipsw:delete-file", t),
        changeDir: (d) => electron_1.ipcRenderer.invoke("ipsw:change-dir", d),
        onReload: (cb) => listen("ipsw:reload", cb)
    },
    requestModelData: (identifier) => electron_1.ipcRenderer.invoke("dh:requestModelData", identifier),
    onModelData: (cb) => {
        const handler = (_event, id, device) => cb(id, device);
        electron_1.ipcRenderer.on("dh:modelData", handler);
        return () => {
            electron_1.ipcRenderer.off("dh:modelData", handler);
        };
    },
    getDevices: (product) => electron_1.ipcRenderer.invoke("dh:getDevices", product),
    getModelData: (identifier) => electron_1.ipcRenderer.invoke("dh:getModelData", identifier)
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
const downloaderAPI = {
    add: (fw, sp) => electron_1.ipcRenderer.invoke('dm:add', fw, sp),
    pause: (id) => electron_1.ipcRenderer.invoke("dm:pause", id),
    resume: (id) => electron_1.ipcRenderer.invoke("dm:resume", id),
    cancel: (id) => electron_1.ipcRenderer.invoke("dm:cancel", id),
    getAllTask: () => electron_1.ipcRenderer.invoke("dm:getAllTask"),
    getIncompleteTasks: () => electron_1.ipcRenderer.invoke("dm:getIncompleteTasks"),
    resumeIncomplete: (id) => electron_1.ipcRenderer.invoke("dm:resumeIncomplete", id),
    deleteIncomplete: (id) => electron_1.ipcRenderer.invoke("dm:deleteIncomplete", id),
    onStarted: (cb) => listen("dm:started", cb),
    onAdded: (cb) => listen("dm:added", cb),
    onCompleted: (cb) => listen("dm:completed", cb),
    onProgress: (cb) => listen("dm:progress", cb),
    onPaused: (cb) => listen("dm:paused", cb),
    onResumed: (cb) => listen("dm:resumed", cb),
    onCancelled: (cb) => listen("dm:cancelled", cb),
    onIncompleteDeleted: (cb) => listen("dm:incomplete_deleted", cb),
    onError: (cb) => listen("dm:error", cb),
};
electron_1.contextBridge.exposeInMainWorld('api', api);
electron_1.contextBridge.exposeInMainWorld('downloader', downloaderAPI);
electron_1.contextBridge.exposeInMainWorld('store', storeApi);
electron_1.contextBridge.exposeInMainWorld('updater', updaterApi);
electron_1.contextBridge.exposeInMainWorld('ipsw_api', {
    devices: 'https://api.ipsw.me/v4/devices',
    getFirmware: 'https://api.ipsw.me/v4/device/$id?type=ipsw',
    releases: 'https://api.ipsw.me/v4/releases'
});
