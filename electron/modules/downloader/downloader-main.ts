import * as path from "path";
import { Worker } from "worker_threads";
import { randomUUID } from "crypto";

import type { MainToWorker, WorkerToMain } from "./worker-messages";
import type { DownloadManagerOptions, AddOptions, EventChannel, AddResult, IncompleteTask, Task, LifecycleResult } from "@custom-type/downloader";
import { IntegrityChecker } from "./integrity";
import { ipcMain } from "electron";

interface BrowserWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: any[]): void };
}

export class DownloaderMain {
  private readonly win: BrowserWindow;
  private readonly stateDir: string;
  private readonly config: DownloadManagerOptions;
  private readonly onConfigChange?: (config: DownloadManagerOptions) => void;
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>();
  private readonly callTimeoutMs = 30_000;
  private integrityChecker = new IntegrityChecker();
  private verifyControllers = new Map<string, AbortController>();

  constructor(win: BrowserWindow, opts: DownloadManagerOptions, onConfigChange?: (config: DownloadManagerOptions) => void) {
    this.win = win;
    this.config = opts;
    this.stateDir = opts.paths.stateDir;
    this.onConfigChange = onConfigChange;
    this.registerIPC();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(path.join(__dirname, "downloader-worker.js"), {
      workerData: {
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

  add(firmware: Firmware, options: AddOptions = {}): Promise<AddResult> {
    return this.call({ type: "add", reqId: randomUUID(), firmware, options });
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

  deleteIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    return this.call({ type: "deleteIncomplete", reqId: randomUUID(), id });
  }

  getConfig(): Promise<DownloadManagerOptions> {
    return this.call({ type: "getConfig", reqId: randomUUID() });
  }

  async setConfig(partial: DownloadManagerOptions): Promise<void> {
    // Deep merge into local config
    this.mergeConfig(this.config, partial);
    // Persist to store
    this.onConfigChange?.(this.config);
    // Forward to worker
    return this.call({ type: "setConfig", reqId: randomUUID(), partial });
  }

  private mergeConfig(target: DownloadManagerOptions, partial: DownloadManagerOptions): void {
    if (partial.paths) Object.assign(target.paths, partial.paths);
    if (partial.network) target.network = { ...target.network, ...partial.network };
    if (partial.scheduler) target.scheduler = { ...target.scheduler, ...partial.scheduler };
    if (partial.download) target.download = { ...target.download, ...partial.download };
    if (partial.integrity) target.integrity = { ...target.integrity, ...partial.integrity };
    if (partial.recovery) target.recovery = { ...target.recovery, ...partial.recovery };
  }

  async startVerify(identifier: string, filePath: string, firmware: Firmware): Promise<void> {
    this.cancelVerify(identifier);

    this.verifyControllers.set(identifier, new AbortController());

    try {
      const algo = firmware.md5sum ? "md5" as const
        : firmware.sha1sum ? "sha1" as const
        : firmware.sha256sum ? "sha256" as const
        : null;

      if (!algo) {
        if (!this.win || this.win.isDestroyed()) return;
        this.win.webContents.send("dm:verify-completed", {
          identifier, ok: true, algo: null, expected: "", actual: "",
        });
        return;
      }

      const expected = algo === "md5" ? firmware.md5sum!
        : algo === "sha1" ? firmware.sha1sum!
        : firmware.sha256sum!;

      const result = await this.integrityChecker.verify(
        filePath, algo, expected,
        (progress) => {
          if (!this.win || this.win.isDestroyed()) return;
          this.win.webContents.send("dm:verify-progress", {
            identifier, pct: progress.pct, speed: progress.speed, eta: progress.eta,
          });
        },
      );

      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("dm:verify-completed", {
          identifier, ok: result.ok, algo: result.algo,
          expected: result.expected, actual: result.actual,
        });
      }
    } catch (err: any) {
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("dm:verify-error", { identifier, error: err.message });
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
      ["dm:add", (_e: any, firmware: Firmware, options: AddOptions) => this.add(firmware, options)],
      ["dm:pause", (_e: any, id: string) => this.pause(id)],
      ["dm:resume", (_e: any, id: string) => this.resume(id)],
      ["dm:cancel", (_e: any, id: string) => this.cancel(id)],
      ["dm:deleteIncomplete", (_e: any, id: string) => this.deleteIncomplete(id)],
      ["dm:getConfig", () => this.getConfig()],
      ["dm:setConfig", (_e: any, partial: DownloadManagerOptions) => this.setConfig(partial)],
      ["dm:getAllTask", () => this.getAllTask()],
      ["dm:getIncompleteTasks", () => this.getIncompleteTasks()],
      ["dm:verify", (_e: any, identifier: string, filePath: string, firmware: Firmware) => { this.startVerify(identifier, filePath, firmware); }],
      ["dm:verify-cancel", (_e: any, identifier: string) => { this.cancelVerify(identifier); }],
    ];

    for (const [channel, handler] of handlers) {
      try { ipcMain.removeHandler(channel); } catch { }
      ipcMain.handle(channel, handler);
    }
  }
}
