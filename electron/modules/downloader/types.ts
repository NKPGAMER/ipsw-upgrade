export type TaskStatus = "queued" | "downloading" | "paused" | "completed" | "error" | "verifying" | "moving" | "cancelled";

export type DownloadMode = "turbo" | "normal";

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
  mode: DownloadMode;
}

export interface ChunkState {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  completed: boolean;
}

export interface DownloadState {
  id: string;
  firmware: Firmware;
  savePath: string;
  tmpPath: string;
  totalSize: number;
  chunks: ChunkState[];
  supportsRanges: boolean;
  createdAt: number;
  updatedAt: number;
  mode: DownloadMode;
  movedChunks: number[];
}

export interface AddResult {
  success: boolean;
  id?: string;
  error?: "DISK_FULL" | "ALREADY_IN_LIST" | "INVALID_URL" | "INVALID_SAVE_PATH" | "UNKNOWN";
}

export interface DownloadRequestConfig {
  deleteFiles?: IPSWFile[];
}

export interface DiskInfo {
  path: string;
  available: number;
  total: number;
  isSSd: boolean;
}

export interface DriveEnvInfo {
  /** Drive root, e.g. "C:\\" */
  path: string;
  mediaType: "SSD" | "HDD";
}

export interface DiskEnvironmentInfo {
  environment: "ssd_save" | "hdd_ssd_tmp" | "hdd_only";
  saveDrive: DriveEnvInfo;
  /** The SSD chosen for temp files, or null when no suitable SSD exists */
  tmpDrive: DriveEnvInfo | null;
}

export interface IncompleteTask {
  id: string;
  firmware: Firmware;
  savePath: string;
  tmpPath: string;
  totalSize: number;
  downloadedBytes: number;
  progress: number;          // 0–100
  tmpExists: boolean;        // tmp file still on disk
  savedAt: number;           // updatedAt timestamp from state
  mode: DownloadMode;
  movedChunks: number[];
}

export interface DownloaderConfig {
  maxConcurrentTasks?: number;
  maxConnectionsPerTask?: number;
  initialConnectionsPerTask?: number;
  chunkSize?: number;
  retryLimit?: number;
  retryDelay?: number;
  diskBufferGB?: number;
  bandwidthLimitBps?: number;
  tmpDir?: string;
  turboMode?: boolean;
  skipVerify?: boolean;
  turboConnectionsMultiplier?: number;
  turboChunkSizeMultiplier?: number;
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
