import { contextBridge, FileFilter, ipcRenderer } from 'electron';
import type { ElectronApi, ElectronStoreApi, ElectronUpdaterApi, DownloaderAPI } from '../preload';

function listen<T extends any[]>(
  channel: string,
  cb: (...args: T) => void
): EventResponse {
  const handler = (_: any, ...args: T) => cb(...args);
  ipcRenderer.on(channel, handler);

  return {
    unsubscribe: () => ipcRenderer.removeListener(channel, handler)
  };
}

const versionArg = process.argv.find(arg => arg.startsWith('--app-version'));

const api: ElectronApi = {
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  getDiskSpace: (targetPath?: string) => ipcRenderer.invoke('getDiskSpace', targetPath),
  formatBytes: (bytes: number, decimals?: number) => ipcRenderer.invoke('formatBytes', bytes, decimals),
  getVersion: versionArg ? versionArg.split("=")[1] : "unknown",
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options?: FileFilter[]) => ipcRenderer.invoke('select-file', options),

  file: {
    getFiles: () => ipcRenderer.invoke("ipsw:get-files"),
    delete: (t) => ipcRenderer.invoke("ipsw:delete-file", t),
    changeDir: (d) => ipcRenderer.invoke("ipsw:change-dir", d),
    onReload: (cb) => listen("ipsw:reload", cb)
  },

  onMessage: (cb) => listen("message", cb),

  requestModelData: (identifier: string) => ipcRenderer.invoke("dh:requestModelData", identifier),

  getDeviceModelData: (identifier: string) =>
    ipcRenderer.invoke("dh:getDeviceModelData", identifier),

  onDeviceDataUpdated: (cb) => {
    const handler = (_event: any, payload: DeviceDataUpdatedPayload) => cb(payload);
    ipcRenderer.on("dh:deviceDataUpdated", handler);
    return () => {
      ipcRenderer.off("dh:deviceDataUpdated", handler);
    };
  },

  onModelData: (cb) => {
    const handler = (_event: any, id: Device['identifier'], device: DeviceResponse) => cb(id, device)
    ipcRenderer.on("dh:modelData", handler);

    return () => {
      ipcRenderer.off("dh:modelData", handler);
    };
  },

  getDevices: (product) => ipcRenderer.invoke("dh:getDevices", product),
  getModelData: (identifier) => ipcRenderer.invoke("dh:getModelData", identifier)
}

const storeApi: ElectronStoreApi = {
  set: (key: string, value?: any) => ipcRenderer.invoke('store', 'set', key, value),
  get: (key: string) => ipcRenderer.invoke('store', 'get', key),
  has: (key: string) => ipcRenderer.invoke('store', 'has', key),
  delete: (key: string) => ipcRenderer.invoke('store', 'delete', key)
};

const updaterApi: ElectronUpdaterApi = {
  onUpdateAvailable: (cb: (data: any) => void) => ipcRenderer.on('update-available', (_, d) => cb(d)),
  onUpdateReady: (cb: () => void) => ipcRenderer.on('update-ready', () => cb()),
  onUpdateProgress: (cb: (data: any) => void) => ipcRenderer.on('update-progress', (_, data) => cb(data)),
  check: () => ipcRenderer.invoke('updater:check'),
  start: () => ipcRenderer.send('updater:start'),
  install: () => ipcRenderer.send('updater:install')
}

const downloaderAPI: DownloaderAPI = {
  add: (fw, config) => ipcRenderer.invoke('dm:add', fw, config),
  pause: (id) => ipcRenderer.invoke("dm:pause", id),
  resume: (id) => ipcRenderer.invoke("dm:resume", id),
  cancel: (id) => ipcRenderer.invoke("dm:cancel", id),
  getAllTask: () => ipcRenderer.invoke("dm:getAllTask"),
  getIncompleteTasks: () => ipcRenderer.invoke("dm:getIncompleteTasks"),
  resumeIncomplete: (id) => ipcRenderer.invoke("dm:resumeIncomplete", id),
  deleteIncomplete: (id) => ipcRenderer.invoke("dm:deleteIncomplete", id),
  getEnvironmentInfo: (savePath: string) => ipcRenderer.invoke("dm:getEnvironmentInfo", savePath),

  onStarted: (cb) => listen("dm:started", cb),
  onAdded: (cb) => listen("dm:added", cb),
  onCompleted: (cb) => listen("dm:completed", cb),
  onProgress: (cb) => listen("dm:progress", cb),
  onPaused: (cb) => listen("dm:paused", cb),
  onResumed: (cb) => listen("dm:resumed", cb),
  onCancelled: (cb) => listen("dm:cancelled", cb),
  onIncompleteDeleted: (cb) => listen("dm:incomplete_deleted", cb),
  onError: (cb) => listen("dm:error", cb),
}

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('downloader', downloaderAPI);
contextBridge.exposeInMainWorld('store', storeApi);
contextBridge.exposeInMainWorld('updater', updaterApi);