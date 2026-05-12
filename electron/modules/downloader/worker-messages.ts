/**
 * worker-messages.ts
 * Shared message-type contract between the main thread and the downloader worker.
 * Keep this file free of any Electron imports — it must be importable in both contexts.
 */

import type { Task, TaskStatus, AddResult, IncompleteTask, DownloaderConfig, DownloadRequestConfig } from "./types";

// ─── Main → Worker ────────────────────────────────────────────────────────────

export type MainToWorker =
  | { type: "init";               config: DownloaderConfig; stateDir: string }
  | { type: "add";                reqId: string; firmware: Firmware; config: DownloadRequestConfig }
  | { type: "pause";              id: string }
  | { type: "resume";             id: string }
  | { type: "cancel";             id: string }
  | { type: "getAllTask";         reqId: string }
  | { type: "getIncompleteTasks"; reqId: string }
  | { type: "resumeIncomplete";   reqId: string; id: string }
  | { type: "deleteIncomplete";   reqId: string; id: string }
  | { type: "getEnvironmentInfo"; reqId: string; savePath: string };

// ─── Worker → Main ────────────────────────────────────────────────────────────

/** Responses to request/reply calls */
export type WorkerReply =
  | { type: "reply"; reqId: string; result: any; error?: string };

/** Spontaneous event emissions */
export type WorkerEvent =
  | { type: "event"; channel: "started";            taskId: string; task: Task }
  | { type: "event"; channel: "progress";           taskId: string; task: Task }
  | { type: "event"; channel: "completed";          taskId: string; task: Task }
  | { type: "event"; channel: "error";              taskId: string; error: string; task: Task }
  | { type: "event"; channel: "paused";             taskId: string; task: Task }
  | { type: "event"; channel: "resumed";            taskId: string; task: Task }
  | { type: "event"; channel: "added";              taskId: string; task: Task }
  | { type: "event"; channel: "cancelled";          taskId: string }
  | { type: "event"; channel: "incomplete_deleted"; taskId: string };

export type WorkerToMain = WorkerReply | WorkerEvent;
