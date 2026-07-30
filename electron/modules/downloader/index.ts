export { IPSWDownloader } from "./downloader";
export { DownloaderMain } from "./downloader-main";
export { DiskManager } from "./disk-manager";
export { StateManager } from "./state-manager";
export { ChunkManager } from "./chunk-manager";
export { TaskScheduler, TransferScheduler, TaskScheduler as Scheduler } from "./scheduler";
export type { SchedulerTask, TransferTask } from "./scheduler";
export { IntegrityChecker } from "./integrity";

export type {
  Task,
  TaskStatus,
  CompactChunk,
  DownloadState,
  AddResult,
  DownloadManagerOptions,
  AddOptions,
  IncompleteTask,
} from "@custom-type/downloader";

export type { MainToWorker, WorkerToMain, WorkerEvent, WorkerReply } from "./worker-messages";
