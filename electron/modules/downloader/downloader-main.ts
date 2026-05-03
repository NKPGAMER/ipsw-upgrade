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
  private worker: Worker | null = null;
  private win?: BrowserWindow;
  private readonly stateDir: string;
  private readonly config: DownloaderConfig;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

  constructor(win?: BrowserWindow, opts: DownloaderMainOptions = { stateDir: ".ipsw-state" }) {
    this.win = win;
    this.stateDir = opts.stateDir;
    this.config = opts.config ?? {};

    this.registerIPC();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(path.join(__dirname, "downloader-worker.js"), {
      workerData: {
        stateDir: this.stateDir,
        config: this.config,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });

    this.worker.on("message", (msg: WorkerToMain) => this.handleWorkerMessage(msg));
    this.worker.on("error", (err: Error) => console.error("[DownloaderMain] worker error:", err));
    this.worker.on("exit", (code: number) => {
      if (code !== 0) console.error(`[DownloaderMain] worker exited with code ${code}`);
      this.worker = null;
    });

    return this.worker;
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
      this.ensureWorker().postMessage({ ...msg, reqId });
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  add(firmware: Firmware, savePath: string, config: { deleteFiles?: IPSWFile[] } = {}): Promise<AddResult> {
    return this.call<AddResult>({ type: "add", reqId: randomUUID(), firmware, savePath, config });
  }

  pause(id: string): void  { this.ensureWorker().postMessage({ type: "pause",  id } satisfies MainToWorker); }
  resume(id: string): void { this.ensureWorker().postMessage({ type: "resume", id } satisfies MainToWorker); }
  cancel(id: string): void { this.ensureWorker().postMessage({ type: "cancel", id } satisfies MainToWorker); }

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
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    await worker.terminate();
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
    let ipcMain: { handle(channel: string, listener: (...args: any[]) => any): void; removeHandler(channel: string): void };
    try {
      ipcMain = require("electron").ipcMain;
    } catch {
      console.warn("[DownloaderMain] electron not available — IPC not registered");
      return;
    }

    const handlers: Array<[string, (...args: any[]) => any]> = [
      ["dm:add", (_e: any, firmware: Firmware, savePath: string) => this.add(firmware, savePath)],
      ["dm:pause", (_e: any, id: string) => { this.pause(id); }],
      ["dm:resume", (_e: any, id: string) => { this.resume(id); }],
      ["dm:cancel", (_e: any, id: string) => { this.cancel(id); }],
      ["dm:getAllTask", () => this.getAllTask()],
      ["dm:getIncompleteTasks", () => this.getIncompleteTasks()],
      ["dm:resumeIncomplete", (_e: any, id: string) => this.resumeIncomplete(id)],
      ["dm:deleteIncomplete", (_e: any, id: string) => this.deleteIncomplete(id)],
    ];

    for (const [channel, handler] of handlers) {
      try { ipcMain.removeHandler(channel); } catch {}
      ipcMain.handle(channel, handler);
    }
  }
}
