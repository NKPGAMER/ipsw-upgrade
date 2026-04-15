/**
 * downloader-main.ts
 *
 * Main-thread orchestrator.
 *
 * Responsibilities:
 *  1. Spawn the downloader Worker thread (downloader-worker.ts)
 *  2. Provide a request/reply bridge for async Worker calls (add, getAllTask, …)
 *  3. Forward spontaneous Worker events → BrowserWindow.webContents.send (renderer)
 *  4. Register ipcMain handlers so the renderer can invoke downloader methods
 *
 * Usage (in your main Electron entry-point):
 *
 *   import { DownloaderMain } from "./downloader/downloader-main";
 *
 *   const downloader = new DownloaderMain(mainWindow, {
 *     stateDir: path.join(app.getPath("userData"), ".ipsw-state"),
 *     config: { maxConcurrentTasks: 3 },
 *   });
 *
 *   // On window close / app quit:
 *   await downloader.destroy();
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { randomUUID } from "crypto";

import type { MainToWorker, WorkerToMain } from "./worker-messages";
import type { DownloaderConfig, EventChannel, AddResult, IncompleteTask, Task } from "./types";

// Electron types — resolved at runtime; typed loosely so this file compiles
// without depending on a specific @types/electron version.
// In your project these will be inferred correctly from Electron's bundled types.
interface BrowserWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: any[]): void };
}

export interface DownloaderMainOptions {
  /** Absolute path to the state directory — passed to the worker. */
  stateDir: string;
  config?: DownloaderConfig;
}

export class DownloaderMain {
  private worker: Worker;
  private win?: BrowserWindow;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

  constructor(win?: BrowserWindow, opts: DownloaderMainOptions = { stateDir: ".ipsw-state" }) {
    this.win = win;

    this.worker = new Worker(
      path.join(__dirname, "downloader-worker.js"),
      {
        workerData: {
          stateDir: opts.stateDir,
          config:   opts.config ?? {},
        },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      }
    );

    this.worker.on("message", (msg: WorkerToMain) => this.handleWorkerMessage(msg));
    this.worker.on("error",   (err: Error) => console.error("[DownloaderMain] worker error:", err));
    this.worker.on("exit",    (code: number) => {
      if (code !== 0) console.error(`[DownloaderMain] worker exited with code ${code}`);
    });

    if (win) this.registerIPC();
  }

  // ─── Worker message handler ───────────────────────────────────────────────

  private handleWorkerMessage(msg: WorkerToMain): void {
    if (msg.type === "reply") {
      const pending = this.pending.get(msg.reqId);
      if (pending) {
        this.pending.delete(msg.reqId);
        msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg.result);
      }
      return;
    }

    if (msg.type === "event") {
      const { channel, ...rest } = msg;
      this.sendToRenderer(channel, rest as any);
    }
  }

  // ─── Request / reply helper ───────────────────────────────────────────────

  private call<T>(msg: MainToWorker): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const reqId = randomUUID();
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ ...msg, reqId });
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  add(firmware: Firmware, savePath: string): Promise<AddResult> {
    return this.call<AddResult>({ type: "add", reqId: randomUUID(), firmware, savePath });
  }

  pause(id: string): void  { this.worker.postMessage({ type: "pause",  id } satisfies MainToWorker); }
  resume(id: string): void { this.worker.postMessage({ type: "resume", id } satisfies MainToWorker); }
  cancel(id: string): void { this.worker.postMessage({ type: "cancel", id } satisfies MainToWorker); }

  getAllTask(): Promise<Task[]> {
    return this.call<Task[]>({ type: "getAllTask", reqId: randomUUID() });
  }

  getIncompleteTasks(): Promise<IncompleteTask[]> {
    return this.call<IncompleteTask[]>({ type: "getIncompleteTasks", reqId: randomUUID() });
  }

  resumeIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    return this.call({ type: "resumeIncomplete", reqId: randomUUID(), id });
  }

  deleteIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    return this.call({ type: "deleteIncomplete", reqId: randomUUID(), id });
  }

  /** Terminate the worker gracefully. Call on app quit. */
  async destroy(): Promise<void> {
    await this.worker.terminate();
  }

  // ─── Renderer bridge ─────────────────────────────────────────────────────

  private sendToRenderer(channel: EventChannel, payload: {
    taskId?: string;
    task?: Task;
    error?: string;
  }): void {
    if (!this.win || this.win.isDestroyed()) return;
    const { taskId, task, error } = payload;
    switch (channel) {
      case "started":
      case "progress":
      case "completed":
      case "paused":
      case "resumed":
      case "added":
        this.win.webContents.send(`dm:${channel}`, taskId, task);
        break;
      case "error":
        this.win.webContents.send(`dm:${channel}`, taskId, error, task);
        break;
      case "cancelled":
      case "incomplete_deleted":
        this.win.webContents.send(`dm:${channel}`, taskId);
        break;
    }
  }

  // ─── IPC registration ─────────────────────────────────────────────────────

  private registerIPC(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let ipcMain: { handle(channel: string, listener: (...args: any[]) => any): void };
    try {
      ipcMain = require("electron").ipcMain;
    } catch {
      console.warn("[DownloaderMain] electron not available — IPC not registered");
      return;
    }

    ipcMain.handle("dm:add",                (_e: any, firmware: Firmware, savePath: string) => this.add(firmware, savePath));
    ipcMain.handle("dm:pause",              (_e: any, id: string) => { this.pause(id); });
    ipcMain.handle("dm:resume",             (_e: any, id: string) => { this.resume(id); });
    ipcMain.handle("dm:cancel",             (_e: any, id: string) => { this.cancel(id); });
    ipcMain.handle("dm:getAllTask",          () => this.getAllTask());
    ipcMain.handle("dm:getIncompleteTasks", () => this.getIncompleteTasks());
    ipcMain.handle("dm:resumeIncomplete",   (_e: any, id: string) => this.resumeIncomplete(id));
    ipcMain.handle("dm:deleteIncomplete",   (_e: any, id: string) => this.deleteIncomplete(id));
  }
}
