import { app, contextBridge, FileFilter, ipcRenderer } from 'electron';
import type { DownloadOptions, DownloadProgress, DownloadRequest } from './modules/download';
import type { ElectronApi, ElectronDownloaderApi, ElectronStoreApi, ElectronUpdaterApi } from '../src/preload';

const api: ElectronApi = {
  getDiskSpace: (targetPath?: string) => ipcRenderer.invoke('getDiskSpace', targetPath),
  formatBytes: (bytes: number, decimals?: number) => ipcRenderer.invoke('formatBytes', bytes, decimals),
  getVersion: () => ipcRenderer.invoke('get-version'),
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

  app: {
    close: (destroy: boolean) => ipcRenderer.invoke('app:close', destroy)
  }
}

const downloaderApi: ElectronDownloaderApi = {
  onDownloadComplete: (callback) => {
    ipcRenderer.on('download-complete', (_, data) => {
      callback(data);
    });
  },
  onDownloadError: (callback: (data: any) => void) => {
    ipcRenderer.on('download-error', (_, data) => {
      callback(data);
    })
  },
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const subscription = (_event: any, progress: DownloadProgress) => {
      callback(progress);
    };
    ipcRenderer.on('download-progress', subscription);
    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },
  download: (request: DownloadRequest, options: DownloadOptions) => ipcRenderer.invoke('download', request, options),
  pauseDownload: (downloadId: string) => ipcRenderer.invoke('download:pause', downloadId),
  resumeDownload: (downloadId: string) => ipcRenderer.invoke('download:resume', downloadId),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('download:cancel', downloadId),
  getActiveDownloads: () => ipcRenderer.invoke('download:getActiveDownloads')
};

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

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('downloader', downloaderApi);
contextBridge.exposeInMainWorld('store', storeApi);
contextBridge.exposeInMainWorld('updater', updaterApi);
contextBridge.exposeInMainWorld('ipsw_api', {
  devices: 'https://api.ipsw.me/v4/devices',
  getFirmware: 'https://api.ipsw.me/v4/device/$id?type=ipsw',
  releases: 'https://api.ipsw.me/v4/releases'
});