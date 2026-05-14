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
    relaunch: () => electron_1.ipcRenderer.invoke('app:relaunch'),
    getDiskSpace: (targetPath) => electron_1.ipcRenderer.invoke('getDiskSpace', targetPath),
    formatBytes: (bytes, decimals) => electron_1.ipcRenderer.invoke('formatBytes', bytes, decimals),
    getVersion: versionArg ? versionArg.split("=")[1] : "unknown",
    selectFolder: () => electron_1.ipcRenderer.invoke('select-folder'),
    selectFile: (options) => electron_1.ipcRenderer.invoke('select-file', options),
    file: {
        getFiles: () => electron_1.ipcRenderer.invoke("ipsw:get-files"),
        delete: (t) => electron_1.ipcRenderer.invoke("ipsw:delete-file", t),
        changeDir: (d) => electron_1.ipcRenderer.invoke("ipsw:change-dir", d),
        onReload: (cb) => listen("ipsw:reload", cb)
    },
    onMessage: (cb) => listen("message", cb),
    requestModelData: (identifier) => electron_1.ipcRenderer.invoke("dh:requestModelData", identifier),
    getDeviceModelData: (identifier) => electron_1.ipcRenderer.invoke("dh:getDeviceModelData", identifier),
    onDeviceDataUpdated: (cb) => {
        const handler = (_event, payload) => cb(payload);
        electron_1.ipcRenderer.on("dh:deviceDataUpdated", handler);
        return () => {
            electron_1.ipcRenderer.off("dh:deviceDataUpdated", handler);
        };
    },
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
    getStatus: () => electron_1.ipcRenderer.invoke("updater:getStatus"),
    onUpdateAvailable: (cb) => listen("update-available", cb),
    onUpdateReady: (cb) => listen("update-ready", cb),
    onUpdateProgress: (cb) => listen("update-progress", cb),
    onUpdateNotAvailable: (cb) => listen("update-not-available", cb)
};
const downloaderAPI = {
    add: (fw, config) => electron_1.ipcRenderer.invoke('dm:add', fw, config),
    pause: (id) => electron_1.ipcRenderer.invoke("dm:pause", id),
    resume: (id) => electron_1.ipcRenderer.invoke("dm:resume", id),
    cancel: (id) => electron_1.ipcRenderer.invoke("dm:cancel", id),
    getAllTask: () => electron_1.ipcRenderer.invoke("dm:getAllTask"),
    getIncompleteTasks: () => electron_1.ipcRenderer.invoke("dm:getIncompleteTasks"),
    resumeIncomplete: (id) => electron_1.ipcRenderer.invoke("dm:resumeIncomplete", id),
    deleteIncomplete: (id) => electron_1.ipcRenderer.invoke("dm:deleteIncomplete", id),
    getEnvironmentInfo: (savePath) => electron_1.ipcRenderer.invoke("dm:getEnvironmentInfo", savePath),
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
