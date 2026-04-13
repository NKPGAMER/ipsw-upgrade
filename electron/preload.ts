import { contextBridge, FileFilter, ipcRenderer } from 'electron';
import type { ElectronApi, ElectronStoreApi, ElectronUpdaterApi, DownloaderAPI } from '../preload';

function listen<T extends any[]>(
  channel: string,
  cb: (...args: T) => void
) {
  const handler = (_: any, ...args: T) => cb(...args);
  ipcRenderer.on(channel, handler);

  return {
    unsubscribe: () => ipcRenderer.removeListener(channel, handler)
  };
}

const versionArg = process.argv.find(arg => arg.startsWith('--app-version'));

const api: ElectronApi = {
  getDiskSpace: (targetPath?: string) => ipcRenderer.invoke('getDiskSpace', targetPath),
  formatBytes: (bytes: number, decimals?: number) => ipcRenderer.invoke('formatBytes', bytes, decimals),
  getVersion: versionArg ? versionArg.split("=")[1] : "unknown",
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options?: FileFilter[]) => ipcRenderer.invoke('select-file', options),
  getFiles: (folder: string) => ipcRenderer.invoke('get:files:ipsw', folder),
  createMd5: async (filePath: string, options?: Md5Options): Promise<string> => {
    if (options?.onProgress) {
      const progressHandler = (_: any, progress: ProgressInfo) => {
        options.onProgress?.(progress);
      };

      // Lắng nghe progress events
      ipcRenderer.on('md5-progress', progressHandler);

      try {
        // Gọi main process để tính MD5
        const result = await ipcRenderer.invoke('create-md5', filePath);
        return result;
      } finally {
        // Cleanup listener sau khi hoàn thành
        ipcRenderer.removeListener('md5-progress', progressHandler);
      }
    }

    // Không có progress callback - gọi trực tiếp
    return await ipcRenderer.invoke('create-md5', filePath);
  },
  deleteFile: (path: string) => ipcRenderer.invoke('delete-file', path),

  onMessage: (callback) => {
    ipcRenderer.on('ui-message', (_, data) => {
      callback(data);
    });
  },

  onErrorMessage: (callback) => {
    ipcRenderer.on('ui-error-message', (_, data) => {
      callback(data);
    });
  },

  getOnlineState: () => ipcRenderer.invoke('app-get-online-state'),

  onInternetChanged(callback) {
    ipcRenderer.on('internet-changed', (_, online) => {
      callback(online);
    })
  },

  onAppClose(callback) {
    ipcRenderer.on('onAppClose', (_, event) => {
      callback(event)
    })
  },

  sendAppCloseResult(result) {
    ipcRenderer.invoke('closeAppResult', result)
  },

  userData: {
    deleteFile: (fileName: string) => ipcRenderer.invoke('user:deleteFile', fileName),
    read: (fileName: string) => ipcRenderer.invoke('user:read', fileName),
    write: (fileName: string, data: string) => ipcRenderer.invoke('user:write', fileName, data),
  },

  file: {
    getFiles: () => ipcRenderer.invoke("ipsw:get-files"),
    delete: (t) => ipcRenderer.invoke("ipsw:delete-file", t),
    changeDir: (d) => ipcRenderer.invoke("ipsw:change-dir", d),
    onReload: (cb) => listen("ipsw:reload", cb)
  },

  requestModelData: (identifier: string) => ipcRenderer.invoke("dh:requestModelData", identifier),

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
  add: (fw, sp) => ipcRenderer.invoke('dm:add', fw, sp),
  pause: (id) => ipcRenderer.invoke("dm:pause", id),
  resume: (id) => ipcRenderer.invoke("dm:resume", id),
  cancel: (id) => ipcRenderer.invoke("dm:cancel", id),
  getAllTask: () => ipcRenderer.invoke("dm:getAllTask"),
  getIncompleteTasks: () => ipcRenderer.invoke("dm:getIncompleteTasks"),
  resumeIncomplete: (id) => ipcRenderer.invoke("dm:resumeIncomplete", id),
  deleteIncomplete: (id) => ipcRenderer.invoke("dm:deleteIncomplete", id),

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
contextBridge.exposeInMainWorld('ipsw_api', {
  devices: 'https://api.ipsw.me/v4/devices',
  getFirmware: 'https://api.ipsw.me/v4/device/$id?type=ipsw',
  releases: 'https://api.ipsw.me/v4/releases'
});
