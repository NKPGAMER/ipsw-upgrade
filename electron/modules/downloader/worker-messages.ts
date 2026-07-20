/**
 * worker-messages.ts
 * Shared message-type contract between the main thread and the downloader worker.
 * Keep this file free of any Electron imports — it must be importable in both contexts.
 */

import type { Task, DownloadManagerOptions, AddOptions } from "@custom-type/downloader";

// ─── Main → Worker ────────────────────────────────────────────────────────────

export type MainToWorker =
  | { type: "init";               config: DownloadManagerOptions }
  | { type: "add";                reqId: string; firmware: Firmware; options: AddOptions }
  | { type: "pause";              reqId: string; id: string }
  | { type: "resume";             reqId: string; id: string }
  | { type: "cancel";             reqId: string; id: string }
  | { type: "getAllTask";         reqId: string }
  | { type: "getIncompleteTasks"; reqId: string }
 | { type: "deleteIncomplete";   reqId: string; id: string }
  | { type: "getConfig";          reqId: string }
  | { type: "setConfig";          reqId: string; partial: DownloadManagerOptions };

// ─── Worker → Main ────────────────────────────────────────────────────────────

export type WorkerReply =
  | { type: "reply"; reqId: string; result: any; error?: string };

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
