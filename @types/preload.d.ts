import type { FileFilter, IpcRendererEvent } from "electron";
import type { UpdateInfo } from "electron-updater";
import type { FSWatcher, WriteStream } from 'fs';
import type { ChildProcess } from 'child_process';
import type { ClientRequest } from "http";
import type { Task, AddResult, IncompleteTask, AddOptions, DownloadManagerOptions, EventChannel, LifecycleResult } from "./downloader"
import type { DiskInfo } from "../electron/i10r-addon/index";

/* ---------- Common types ---------- */

interface UpdateAvailableData {
  version: string;
  notes: string | string[] | null;
}

interface UpdateProgressData {
  percent: number;
  transferred: string;
  total: string;
}

interface UpdateInfoResult {
  status: "no-update" | "update-available" | "error";
  info?: UpdateInfo;
  error?: string;
}

interface ElectronApi {
  relaunch: () => Promise<void>;
  ready: () => void;
  getDiskSpace: (targetPath?: string) => Promise<DiskSpace>;
  getAllDisk: () => Promise<DiskInfo[]>;
  formatBytes: (bytes: number, decimals?: number) => Promise<string>;
  getVersion: string;

  selectFolder: () => Promise<string | null>;
  selectFile: (options?: FileFilter[]) => Promise<string | null>;

  file: {
    getFiles: () => Promise<IPSWFile[]>,
    delete: (target: string | string[] | IPSWFile | IPSWFile[]) => Promise<void>;
    changeDir: (newDir: string) => Promise<void>;
    onReload: (callback: (files: IPSWFile[]) => void) => EventResponse;
  },

  onMessage: (cb: (message: string, options: { type: 'success' | 'error' | 'warning' | 'info' } = { type: 'success' }) => void) => EventResponse;

  requestModelData: (identifier: Device['identifier']) => void;

  onModelData: (callback: (identifier: Device['identifier'], device: DeviceResponse | null) => void) => () => void;

  getDeviceModelData: (identifier: string) => Promise<ModelDataResult>;
  onDeviceDataUpdated: (callback: (payload: DeviceDataUpdatedPayload) => void) => () => void;

  getDevices: (product?: Product) => Promise<Device[]>;
  getModelData: (identifier: Device['identifier']) => Promise<DeviceResponse>;
}

interface ElectronStoreApi {
  set: (key: string, value?: any) => Promise<void>;
  get: (key: string) => Promise<any>;
  has: (key: string) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
}

interface UpdateStatus {
  phase: "idle" | "downloading" | "ready" | "no-update";
  version?: string;
  notes?: string | string[] | null;
  progress?: { percent: number; transferred: string; total: string };
}

interface ElectronUpdaterApi {
  getStatus: () => Promise<UpdateStatus>;
  onUpdateAvailable: (cb: (data: UpdateAvailableData) => void) => EventResponse;
  onUpdateReady: (cb: () => void) => EventResponse;
  onUpdateProgress: (cb: (data: UpdateProgressData) => void) => EventResponse;
  onUpdateNotAvailable: (cb: () => void) => EventResponse;
}

interface DownloaderAPI {
  add: (firmware: Firmware, options?: AddOptions) => Promise<AddResult>;
  pause: (id: string) => Promise<LifecycleResult>;
  resume: (id: string) => Promise<LifecycleResult>;
  cancel: (id: string) => Promise<LifecycleResult>;
  getAllTask: () => Promise<Task[]>;
  getIncompleteTasks: () => Promise<IncompleteTask>;
  deleteIncomplete: (id: string) => Promise<{ success: boolean; error?: string }>;
  getConfig: () => Promise<DownloadManagerOptions>;
  setConfig: (partial: DownloadManagerOptions) => Promise<void>;

  verifyChecksum: (identifier: string, filePath: string, firmware: Firmware) => Promise<void>;
  cancelVerify: (identifier: string) => Promise<void>;

  // Events
  onStarted: (cb: (id: string, task: Task) => void) => EventResponse;
  onAdded: (cb: (id: string, task: Task) => void) => EventResponse;
  onCompleted: (cb: (id: string, task: Task) => void) => EventResponse;
  onProgress: (cb: (id: string, task: Task) => void) => EventResponse;
  onPaused: (cb: (id: string, task: Task) => void) => EventResponse;
  onResumed: (cb: (id: string, task?: Task) => void) => EventResponse;
  onCancelled: (cb: (id: string) => void) => EventResponse;
  onIncompleteDeleted: (cb: (id: string) => void) => EventResponse;
  onError: (cb: (id: string, error: string, task: Task) => void) => EventResponse;

  onVerifyProgress: (cb: (info: VerifyProgressInfo) => void) => EventResponse;
  onVerifyCompleted: (cb: (info: VerifyCompletedInfo) => void) => EventResponse;
  onVerifyCancelled: (cb: (info: VerifyCancelledInfo) => void) => EventResponse;
  onVerifyError: (cb: (info: VerifyErrorInfo) => void) => EventResponse;
}

interface VerifyProgressInfo {
  identifier: string;
  pct: number;
  speed: number;
  eta?: number;
}

interface VerifyCompletedInfo {
  identifier: string;
  ok: boolean;
  algo: string | null;
  expected: string;
  actual: string;
}

interface VerifyCancelledInfo {
  identifier: string;
}

interface VerifyErrorInfo {
  identifier: string;
  error: string;
}

declare global {
  type Product = 'iphone' | 'ipad' | 'watch' | 'mac' | 'realitydevice' | 'tv' | 'homepod' | 'ipod';

  type ModelDataResult = { status: "ready"; data: DeviceResponse } | { status: "wait" };

  interface EventResponse {
    unsubscribe: () => void;
  }

  interface DeviceDataUpdatedPayload {
    identifier: string;
    data: DeviceResponse;
  }
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
  VerifyProgressInfo,
  VerifyCompletedInfo,
  VerifyCancelledInfo,
  VerifyErrorInfo,
};
