export type TaskStatus = "queued" | "downloading" | "paused" | "completed" | "error" | "verifying" | "moving" | "transferring" | "cancelled";

export type EventChannel = "started" | "completed" | "added" | "progress" | "paused" | "resumed" | "cancelled" | "incomplete_deleted" | "error";

export interface Task {
  id: string;
  firmware: Firmware;
  progress: number;
  speed: number;
  status: TaskStatus;
  eta?: number;
  error?: string;
  savePath: string;
}

export type CompactChunk = [number, number, number]; // [start, end, downloaded]

export interface DownloadState {
  id: string;
  firmware: Firmware;
  savePath: string;
  tmpPath: string | null;
  fileName: string;
  totalSize: number;
  chunks: CompactChunk[];
  supportsRanges: boolean;
  createdAt: number;
  updatedAt: number;
  activeOperation: "download" | "verify" | "move" | "transfer";
  lastCheckpoint: number;
  lastWriteTime: number;
}

export interface AddResult {
  success: boolean;
  id?: string;
  error?: "DISK_FULL" | "ALREADY_IN_LIST" | "INVALID_URL" | "INVALID_SAVE_PATH" | "UNKNOWN_DISK_SPACE" | "UNKNOWN";
}

export interface LifecycleResult {
  success: boolean;
  error?: "NOT_FOUND" | "INVALID_STATUS";
}

export interface AddOptions {
  taskId?: string;
}

export interface IncompleteTask {
  id: string;
  firmware: Firmware;
  savePath: string;
  tmpPath: string | null;
  fileName: string;
  totalSize: number;
  downloadedBytes: number;
  progress: number;
  tmpExists: boolean;
  savedAt: number;
}

export interface DownloadManagerOptions {
  paths: {
    saveDir: string;
    stateDir: string;
    useTmp?: boolean;
  };
  network?: {
    maxConnections?: number;
    bandwidthLimit?: number;
  };
  scheduler?: {
    maxSsdTasks?: number;
    maxHddTasks?: number;
    maxExternalSsdTasks?: number;
    maxUsbTasks?: number;
    maxTransfers?: number;
  };
  download?: {
    performance?: "normal" | "high";
    maxTaskConnections?: number;
    taskInitConnections?: number;
    retryLimit?: number;
    retryDelay?: number;
  };
  integrity?: {
    enable?: boolean;
    algorithm?: "MD5" | "SHA1" | "SHA256";
  };
  recovery?: {
    autoResume?: boolean;
  };
}

export interface DownloadEvents {
  progress: (taskId: string, task: Task) => void;
  completed: (taskId: string, task: Task) => void;
  error: (taskId: string, error: string, task: Task) => void;
  paused: (taskId: string, task: Task) => void;
  resumed: (taskId: string, task: Task) => void;
  added: (taskId: string, task: Task) => void;
  cancelled: (taskId: string) => void;
}
