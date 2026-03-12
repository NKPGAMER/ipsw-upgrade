import type { FileFilter, IpcRendererEvent } from "electron";
import type { UpdateInfo } from "electron-updater";
import type { FSWatcher, WriteStream } from 'fs';
import type { ChildProcess } from 'child_process';
import type { ClientRequest } from "http";

/* ---------- Common types ---------- */

interface UpdateAvailableData {
  version: string;
  notes: string | string[] | null;
}

interface UpdateProgressData {
  percent: number;
  transferred: number;
  total: number;
}

interface UpdateInfoResult {
  status: "no-update" | "update-available" | "error";
  info?: UpdateInfo;
  error?: string;
}

interface ElectronApi {
  getDiskSpace: (targetPath?: string) => Promise<DiskSpace>,
  formatBytes: (bytes: number, decimals?: number) => Promise<string>,
  getVersion: () => Promise<string>;

  selectFolder: () => Promise<string | null>;
  selectFile: (options?: FileFilter[]) => Promise<string | null>;
  getFiles: (folder: string) => Promise<IPSWFile[]>;
  createMd5: (filePath: string, options: Md5Options) => Promise<any>;
  deleteFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  onMessage: (callback: (message: string) => void) => void;
  onErrorMessage: (callback: (message: string) => void) => void;

  onAppClose: (callback: (options?: {
    taskCount: number
  }) => void) => void;
  sendAppCloseResult: (result: boolean) => void;

  userData: {
    deleteFile: (fileName: string) => Promise<boolean>;
    read: (fileName: string) => Promise<string | null>;
    write: (fileName: string, data: string) => Promise<boolean>;
  };

  app: {
    close: (destroy: boolean) => Promise<void>
  }
}

interface ElectronDownloaderApi {
  onDownloadComplete: (callback: (data: {
    downloadId: string;
    filePath: string;
    request: DownloadRequest;
  }) => void) => void;

  onDownloadError: (callback: (data: {
    downloadId: string;
    error: string;
    request: DownloadRequest;
  }) => void) => void;

  onDownloadProgress: (
    callback: (progress: DownloadProgress) => void
  ) => () => void;

  download: (
    request: DownloadRequest,
    options: DownloadOptions
  ) => Promise<string>;

  pauseDownload: (downloadId: string) => Promise<void>;
  resumeDownload: (downloadId: string) => Promise<void>;
  cancelDownload: (downloadId: string) => Promise<void>;
  getActiveDownloads: () => Promise<DownloadProgress[]>;
}

interface ElectronStoreApi {
  set: (key: string, value?: any) => Promise<void>;
  get: (key: string) => Promise<any>;
  has: (key: string) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
}

interface ElectronUpdaterApi {
  onUpdateAvailable: (cb: (data: UpdateAvailableData) => void) => void;
  onUpdateReady: (cb: () => void) => void;
  onUpdateProgress: (cb: (data: UpdateProgressData) => void) => void;

  check: () => Promise<UpdateInfoResult>;
  start: () => void;
  install: () => void;
}

declare global {
  type Product = 'iphone' | 'ipad' | 'watch' | 'mac' | 'realitydevice' | 'tv' | 'homepod' | 'ipod';
  type ConfirmVariant = "default" | "danger" | "warning" | "info"

  interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
}

  interface FileCheckResult {
    device: string;
    files: IPSWFile[];
    count: number;
  }

  interface DiskSpace {
    total: number;
    used: number;
    available: number;
    percentage: number;
    mount: string;
  }

  interface Device {
    name: string;
    identifier: string;
  }

  interface IPSWFile {
    name: string;
    path: string;
    sizeMB: number;
    size: number;
  }

  interface Firmware {
    identifier: string;
    version: string;
    buildid: string;
    sha1sum: string;
    md5sum: string;
    sha256sum: string;
    filesize: number;
    url: string;
    releasedate: string;
    uploaddate: string;
    signed: boolean;
  }

  interface DownloadRequest {
    fileName: string;
    path: string;
    device: Device;
    priority?: boolean;
    continue?: boolean;
    firmware: Firmware;
  }

  interface DownloadOptions {
    useIDM?: boolean;
    IDMPath?: string;
    maxRedirects?: number;
    timeout?: number;
    fileStableCheckInterval?: number; // Thời gian kiểm tra giữa các lần (ms)
    fileStableCheckCount?: number; // Số lần kiểm tra file ổn định
  }

  interface DownloadProgress {
    downloadId: string;
    url: string;
    fileName: string;
    filePath: string;
    totalSize: number;
    downloadedSize: number;
    progress: number;
    speed: number;
    status: 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isResuming?: boolean;
    pausedByNetwork: boolean;
  }

  interface DownloadTask {
    id: string;
    request: DownloadRequest;
    options: DownloadOptions;
    progress: DownloadProgress;
    controller?: AbortController;
    stream?: WriteStream;
    idmProcess?: ChildProcess;
    folderWatcher?: FSWatcher;
    fileStabilityChecker?: NodeJS.Timeout;
    lastSize: number;
    lastSizeCheck: number;
    redirectCount: number;
    pauseResolve?: () => void;
    resumeFrom: number;
    mode: 'idm' | 'node';
    retryCount: number;
    httpRequest?: ClientRequest
  }

  interface CreateLinkResponse {
    success: boolean;
    error?: string;
  }

  interface Md5Options {
    highWaterMark?: number; // Kích thước buffer
    onProgress?: (progress: ProgressInfo) => void; // Callback tiến độ chi tiết
    throttleMs?: number; // Giới hạn tần suất callback (ms)
  }

  interface ProgressInfo {
    percent: number; // % hoàn thành (0-100)
    bytesRead: number; // Số bytes đã đọc
    totalBytes: number; // Tổng kích thước file
    speed: number; // Tốc độ MB/s
    eta?: number; // Thời gian còn lại (giây)
  }

  interface Window {
    downloader: ElectronDownloaderApi
    api: ElectronApi;
    store: ElectronStoreApi;
    updater: ElectronUpdaterApi;
    ipsw_api: {
      devices: string;
      getFirmware: string;
      releases: string;
    };

  }
}

export { ElectronApi, ElectronDownloaderApi, ElectronStoreApi, ElectronUpdaterApi };
