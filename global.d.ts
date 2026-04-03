export interface Firmware {
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

export type TaskStatus = "queued" | "downloading" | "paused" | "completed" | "error" | "verifying" | "moving";

export type EventChannel = "completed" | "added" | "progress" | "paused" | "resumed" | "cancelled" | "incomplete_deleted" | "error";

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
}

export interface AddResult {
  success: boolean;
  id?: string;
  error?: "DISK_FULL" | "ALREADY_IN_LIST" | "INVALID_URL" | "UNKNOWN";
}

export interface DiskInfo {
  path: string;
  available: number;
  total: number;
  isSSd: boolean;
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
