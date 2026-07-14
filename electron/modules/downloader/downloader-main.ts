import * as path from "path";
import { Worker } from "worker_threads";
import { randomUUID } from "crypto";

import type { MainToWorker, WorkerToMain } from "./worker-messages";
import type { DownloaderConfig, DownloadRequestConfig, EventChannel, AddResult, IncompleteTask, Task, LifecycleResult } from "./types";
import { IntegrityChecker } from "./integrity";
import { app, ipcMain } from "electron";

interface BrowserWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: any[]): void };
}

export class DownloaderMain {
  private readonly win: BrowserWindow;
  private readonly stateDir: string = path.join(app.getPath("userData"), "ipsw-state");
  private readonly config: DownloaderConfig;
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>();
  private readonly callTimeoutMs = 30_000;
  private integrityChecker = new IntegrityChecker();
  private verifyControllers = new Map<string, AbortController>();

  constructor(win: BrowserWindow, opts: DownloaderConfig) {
    this.win = win;
    this.config = opts;

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
    this.worker.on("error", (err: Error) => {
      console.error("[DownloaderMain] worker error:", err);
      this.rejectAllPending(new Error("Worker thread error: " + err.message));
    });
    this.worker.on("exit", (code: number) => {
      if (code !== 0) {
        console.error(`[DownloaderMain] worker exited with code ${code}`);
        this.rejectAllPending(new Error(`Worker thread exited with code ${code}`));
        if (!this.win.isDestroyed()) {
          this.win.webContents.send("dm:worker-crashed");
        }
      }
      this.worker = null;
    });

    return this.worker;
  }

  // ─── Worker message handler ───────────────────────────────────────────────

  private handleWorkerMessage(msg: WorkerToMain): void {
    if (msg.type === "reply") {
      const pending = this.pending.get(msg.reqId);
      if (pending) {
        clearTimeout(pending.timer);
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

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private call<T>(msg: MainToWorker): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const reqId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Worker request timed out: ${msg.type}`));
      }, this.callTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.ensureWorker().postMessage({ ...msg, reqId });
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  add(firmware: Firmware, config: DownloadRequestConfig = {}): Promise<AddResult> {
    return this.call({ type: "add", reqId: randomUUID(), firmware, config });
  }

  pause(id: string): Promise<LifecycleResult> {
    return this.call({ type: "pause", reqId: randomUUID(), id });
  }

  resume(id: string): Promise<LifecycleResult> {
    return this.call({ type: "resume", reqId: randomUUID(), id });
  }

  cancel(id: string): Promise<LifecycleResult> {
    return this.call({ type: "cancel", reqId: randomUUID(), id });
  }

  getAllTask(): Promise<Task[]> {
    return this.call({ type: "getAllTask", reqId: randomUUID() });
  }

  getIncompleteTasks(): Promise<IncompleteTask[]> {
    return this.call({ type: "getIncompleteTasks", reqId: randomUUID() });
  }

  resumeIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    return this.call({ type: "resumeIncomplete", reqId: randomUUID(), id });
  }

  deleteIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    return this.call({ type: "deleteIncomplete", reqId: randomUUID(), id });
  }

  getEnvironmentInfo(savePath: string): Promise<import("./types").DiskEnvironmentInfo> {
    return this.call({ type: "getEnvironmentInfo", reqId: randomUUID(), savePath });
  }

  async startVerify(identifier: string, filePath: string, firmware: Firmware): Promise<void> {
    this.cancelVerify(identifier);

    const controller = new AbortController();
    this.verifyControllers.set(identifier, controller);

    try {
      const result = await this.integrityChecker.verify(
        filePath,
        firmware,
        (progress) => {
          if (!this.win || this.win.isDestroyed()) return;
          this.win.webContents.send("dm:verify-progress", { identifier, pct: progress.pct, speed: progress.speed, eta: progress.eta });
        },
        controller.signal,
      );

      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("dm:verify-completed", {
          identifier, ok: result.ok, algo: result.algo,
          expected: result.expected, actual: result.actual,
        });
      }
    } catch (err: any) {
      if (this.win && !this.win.isDestroyed()) {
        if (err.message === "ABORTED") {
          this.win.webContents.send("dm:verify-cancelled", { identifier });
        } else {
          this.win.webContents.send("dm:verify-error", { identifier, error: err.message });
        }
      }
    } finally {
      this.verifyControllers.delete(identifier);
    }
  }

  cancelVerify(identifier: string): void {
    const controller = this.verifyControllers.get(identifier);
    if (controller) {
      controller.abort();
      this.verifyControllers.delete(identifier);
    }
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
      default:
        console.warn("[DownloaderMain] unknown event channel:", channel);
        break;
    }
  }

  // ─── IPC registration ─────────────────────────────────────────────────────

  private registerIPC(): void {
    const handlers: Array<[string, (...args: any[]) => any]> = [
      ["dm:add", (_e: any, firmware: Firmware, config: DownloadRequestConfig) => this.add(firmware, config)],
      ["dm:pause", (_e: any, id: string) => this.pause(id)],
      ["dm:resume", (_e: any, id: string) => this.resume(id)],
      ["dm:cancel", (_e: any, id: string) => this.cancel(id)],
      ["dm:resumeIncomplete", (_e: any, id: string) => this.resumeIncomplete(id)],
      ["dm:deleteIncomplete", (_e: any, id: string) => this.deleteIncomplete(id)],
      ["dm:getAllTask", () => this.getAllTask()],
      ["dm:getIncompleteTasks", () => this.getIncompleteTasks()],
      ["dm:getEnvironmentInfo", (_e: any, savePath: string) => this.getEnvironmentInfo(savePath)],
      ["dm:verify", (_e: any, identifier: string, filePath: string, firmware: Firmware) => { this.startVerify(identifier, filePath, firmware); }],
      ["dm:verify-cancel", (_e: any, identifier: string) => { this.cancelVerify(identifier); }],
    ];

    for (const [channel, handler] of handlers) {
      try { ipcMain.removeHandler(channel); } catch { }
      ipcMain.handle(channel, handler);
    }
  }
}