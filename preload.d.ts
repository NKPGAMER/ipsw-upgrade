import type { FileFilter, IpcRendererEvent } from "electron";
import type { UpdateInfo } from "electron-updater";
import type { FSWatcher, WriteStream } from 'fs';
import type { ChildProcess } from 'child_process';
import type { ClientRequest } from "http";
import type { Task, AddResult, IncompleteTask, EventChannel } from "./global"

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
  getVersion: string;

  selectFolder: () => Promise<string | null>;
  selectFile: (options?: FileFilter[]) => Promise<string | null>;
  getFiles: (folder: string) => Promise<IPSWFile[]>;
  createMd5: (filePath: string, options: Md5Options) => Promise<any>;
  deleteFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  onMessage: (callback: (message: string) => void) => void;
  onErrorMessage: (callback: (message: string) => void) => void;

  getOnlineState: () => Promise<boolean>;
  onInternetChanged: (callback: (online: boolean) => void) => void;

  onAppClose: (callback: (options?: {
    taskCount: number
  }) => void) => void;
  sendAppCloseResult: (result: boolean) => void;

  userData: {
    deleteFile: (fileName: string) => Promise<void>;
    read: (fileName: string) => Promise<string | null>;
    write: (fileName: string, data: string) => Promise<void>;
  };

  file: {
    getFiles: () => Promise<IPSWFile[]>,
    delete: (target: string | string[] | IPSWFile | IPSWFile[]) => Promise<void>;
    changeDir: (newDir: string) => Promise<void>;
    onReload: (callback: (files: IPSWFile[]) => void) => EventResponse;
  }

  requestModelData: (identifier: Device['identifier']) => void;

  onModelData: (callback: (identifier: Device['identifier'], device: DeviceResponse | null) => void) => () => void;

  getDevices: (product?: Product) => Promise<Device[]>;
  getModelData: (identifier: Device['identifier']) => Promise<DeviceResponse>;
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

interface EventResponse {
  unsubscribe: () => void;
}

interface DownloaderAPI {
  add: (firmware: Firmware, savePath: string, config?: { deleteFiles?: IPSWFile[] }) => Promise<AddResult>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  getAllTask: () => Promise<Task[]>;
  getIncompleteTasks: () => Promise<IncompleteTask[]>;
  resumeIncomplete: (id: string) => Promise<{ success: boolean; error?: string }>;
  deleteIncomplete: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Events
  onStarted:           (cb: (id: string, task: Task) => void) => EventResponse;
  onAdded:             (cb: (id: string, task: Task) => void) => EventResponse;
  onCompleted:         (cb: (id: string, task: Task) => void) => EventResponse;
  onProgress:          (cb: (id: string, task: Task) => void) => EventResponse;
  onPaused:            (cb: (id: string, task: Task) => void) => EventResponse;
  onResumed:           (cb: (id: string, task?: Task) => void) => EventResponse;
  onCancelled:         (cb: (id: string) => void) => EventResponse;
  onIncompleteDeleted: (cb: (id: string) => void) => EventResponse;
  onError:             (cb: (id: string, error: string, task: Task) => void) => EventResponse;
}

interface DownloadProgressInfo {
  downloaded: number;
  total: number;
  pct: number;
  speed: number;
  eta?: number;
  activeChunks: number;
  source: "lan" | "cdn";
}

interface LANShareStatus {
  role: "coordinator" | "peer";
  coordinatorUrl: string;
  peerPort: number;
  nodeId: string;
  shareDir: string;
  fileCount: number;
  storageType: string;
}

interface FileFindResult {
  fileId: string;
  ip: string;
  port: number;
  name: string;
  size: number;
}

interface LANDownloadOpts {
  fileId: string;
  peerIp: string;
  peerPort: number;
  fileName: string;
  fileSize: number;
  firmware: Firmware;
  savePath: string;
}

interface LANShareAPI {
  findFile: (fileName: string) => Promise<FileFindResult | "none">;
  download: (opts: LANDownloadOpts) => Promise<{ success: boolean; via: "lan" | "cdn"; downloadId: string; error?: string }>;
  cancelDownload: (downloadId: string) => Promise<{ success: boolean; error?: string }>;
  isFileOnLAN: (fileName: string) => Promise<{ available: boolean; peerCount: number }>;
  getStatus: () => Promise<LANShareStatus | null>;
  listPeers: () => Promise<{ peers: any[] }>;
  getPeerFiles: (nodeId: string) => Promise<any>;
  getPeerDetail: (nodeId: string) => Promise<any>;
  rescan: () => Promise<void>;
  onProgress: (cb: (info: DownloadProgressInfo) => void) => EventResponse;
  onFallback: (cb: (downloadId: string) => void) => EventResponse;
}

declare global {
  type Product = 'iphone' | 'ipad' | 'watch' | 'mac' | 'realitydevice' | 'tv' | 'homepod' | 'ipod';
  type ConfirmVariant = "default" | "danger" | "warning" | "info";

  interface DeviceResponse {
  name: string;
  identifier: string;
  boardconfig: string;
  platform: string;
  cpid: number;
  bdid: number;
  firmwares: Firmware[];
}

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
    downloader: DownloaderAPI
    lanShare: LANShareAPI;
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

export type {
  ElectronApi,
  ElectronStoreApi,
  ElectronUpdaterApi,
  DownloaderAPI,
  LANShareAPI,
  FileFindResult,
  LANDownloadOpts,
  DownloadProgressInfo,
  LANShareStatus
};
