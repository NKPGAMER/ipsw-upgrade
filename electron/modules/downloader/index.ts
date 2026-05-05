// Public surface of the downloader module
export { IPSWDownloader } from "./downloader";
export { DownloaderMain } from "./downloader-main";
export { DiskManager } from "./disk-manager";
export { StateManager } from "./state-manager";
export { ChunkManager } from "./chunk-manager";
export { Scheduler } from "./scheduler";
export { IntegrityChecker } from "./integrity";

export type {
  Task,
  TaskStatus,
  DownloadMode,
  ChunkState,
  DownloadState,
  AddResult,
  DownloaderConfig,
  IncompleteTask,
  DiskInfo,
} from "./types";

export type { MainToWorker, WorkerToMain, WorkerEvent, WorkerReply } from "./worker-messages";
