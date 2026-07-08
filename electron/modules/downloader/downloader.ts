import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { URL } from "url";

import {
  Task,
  TaskStatus,
  DownloadState,
  ChunkState,
  AddResult,
  LifecycleResult,
  DownloaderConfig,
  IncompleteTask,
  DownloadRequestConfig,
  DownloadMode,
  DiskEnvironmentInfo,
} from "./types";
import { DiskManager } from "./disk-manager";
import { StateManager } from "./state-manager";
import { ChunkManager, type ChunkManagerOptions } from "./chunk-manager";
import { Scheduler, type DownloadEnvironment } from "./scheduler";
import { IntegrityChecker } from "./integrity";
import { StreamHasher } from "./stream-hash";

const GB = 1024 ** 3;
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB

// ─── MoveQueue ────────────────────────────────────────────────────────────────

class MoveQueue {
  private queues = new Map<string, Promise<void>>();
  private concurrency = new Map<string, number>();
  private hddLimit = 2;
  private readonly ssdLimit = 3;

  setHddLimit(n: number): void { this.hddLimit = n; }

  async enqueue(
    src: string,
    dest: string,
    isHDD: boolean,
    priority: boolean = false,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void
  ): Promise<void> {
    const key = this.driveKey(dest);
    const limit = isHDD ? this.hddLimit : this.ssdLimit;

    const prev = this.queues.get(key) ?? Promise.resolve();
    const task = prev.then(() => this.runWhenSlotOpen(key, limit, src, dest, onProgress));

    if (priority) {
      // Turbo moves get priority — swap the pending task
      this.queues.set(key, task.catch(() => { }));
    } else {
      this.queues.set(key, task.catch(() => { }));
    }
    return task;
  }

  private async runWhenSlotOpen(
    key: string,
    limit: number,
    src: string,
    dest: string,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void
  ): Promise<void> {
    while ((this.concurrency.get(key) ?? 0) >= limit) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.concurrency.set(key, (this.concurrency.get(key) ?? 0) + 1);
    try {
      await this.doMove(src, dest, onProgress);
    } finally {
      this.concurrency.set(key, Math.max(0, (this.concurrency.get(key) ?? 0) - 1));
    }
  }

  private async doMove(
    src: string,
    dest: string,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void
  ): Promise<void> {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    try {
      fs.renameSync(src, dest);
      if (onProgress) onProgress({ pct: 100, speed: 0, eta: 0 });
      return;
    } catch { /* cross-device — fall through */ }

    await this.copyViaKernel(src, dest, onProgress);
    fs.unlinkSync(src);
  }

  private async copyViaKernel(
    src: string,
    dest: string,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void
  ): Promise<void> {
    const totalSize = fs.statSync(src).size;
    const startedAt = Date.now();
    const bufferSize = this.getMoveBufferSize(totalSize, this.getAvailableMemoryBytes());

    // Speed/ETA smoothing for copy progress
    const COPY_ALPHA = 0.15;
    let smoothedSpeed = 0;
    let smoothedEta = 0;

    let srcHandle: fs.promises.FileHandle | null = null;
    let destHandle: fs.promises.FileHandle | null = null;

    try {
      srcHandle = await fs.promises.open(src, "r");
      destHandle = await fs.promises.open(dest, "w");

      const buffer = Buffer.allocUnsafe(bufferSize);
      let copied = 0;
      let lastEmitAt = 0;
      let lastPct = -1;

      while (true) {
        const { bytesRead } = await srcHandle.read(buffer, 0, buffer.length, copied);
        if (bytesRead <= 0) break;

        await destHandle.write(buffer, 0, bytesRead, copied);
        copied += bytesRead;

        if (onProgress && totalSize > 0) {
          const now = Date.now();
          const pct = Math.min(99, Math.floor((copied / totalSize) * 100));
          const elapsedSec = Math.max((now - startedAt) / 1000, 0.001);
          const rawSpeed = copied / elapsedSec;
          const rawEta = rawSpeed > 0 ? (totalSize - copied) / rawSpeed : 0;

          // EMA smooth speed
          smoothedSpeed = smoothedSpeed === 0
            ? rawSpeed
            : smoothedSpeed * (1 - COPY_ALPHA) + rawSpeed * COPY_ALPHA;

          // EMA smooth ETA
          smoothedEta = smoothedEta === 0
            ? rawEta
            : smoothedEta * (1 - COPY_ALPHA) + rawEta * COPY_ALPHA;

          if (pct !== lastPct || now - lastEmitAt >= 200 || copied === totalSize) {
            lastEmitAt = now;
            lastPct = pct;
            onProgress({
              pct,
              speed: Math.round(smoothedSpeed),
              eta: Math.max(0, Math.round(smoothedEta)),
            });
          }
        }
      }

      await destHandle.sync().catch(() => { });
      if (onProgress) onProgress({ pct: 100, speed: Math.round(smoothedSpeed || totalSize), eta: 0 });
    } finally {
      await destHandle?.close().catch(() => { });
      await srcHandle?.close().catch(() => { });
    }
  }

  private getMoveBufferSize(totalSize: number, availableMemoryBytes: number): number {
    const mb = 1024 * 1024;
    const fileBased =
      totalSize <= 128 * mb ? 16 * mb :
        totalSize <= 512 * mb ? 32 * mb :
          totalSize <= 2 * GB ? 64 * mb :
            totalSize <= 8 * GB ? 96 * mb :
              128 * mb;

    const memoryBudget = Math.max(16 * mb, Math.floor(availableMemoryBytes * 0.02));
    const memoryAware = Math.max(8 * mb, Math.min(fileBased, memoryBudget));

    return this.alignBufferSize(memoryAware);
  }

  private getAvailableMemoryBytes(): number {
    const free = typeof os.freemem === "function" ? os.freemem() : 0;
    const total = typeof os.totalmem === "function" ? os.totalmem() : 0;
    if (free > 0) return free;
    if (total > 0) return total * 0.25;
    return 256 * 1024 * 1024;
  }

  private alignBufferSize(size: number): number {
    const mb = 1024 * 1024;
    return Math.max(mb, Math.floor(size / mb) * mb);
  }

  private driveKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (process.platform === "win32") return path.parse(resolved).root.toUpperCase();
    const parts = resolved.split(path.sep).filter(Boolean);
    return path.sep + (parts[0] ?? "");
  }
}

// ─── IPSWDownloader ───────────────────────────────────────────────────────────

export class IPSWDownloader extends EventEmitter {
  private config: Required<DownloaderConfig>;
  private tasks = new Map<string, Task>();
  private states = new Map<string, DownloadState>();
  private chunkManagers = new Map<string, ChunkManager>();
  private diskManager: DiskManager;
  private stateManager: StateManager;
  private scheduler: Scheduler;
  private integrity: IntegrityChecker;
  private moveQueue!: MoveQueue;
  private progressEmitState = new Map<string, { lastAt: number; lastProgress: number; timer: NodeJS.Timeout | null; pending: Task | null }>();
  private readonly progressEmitIntervalMs = 150;
  private readonly progressEmitMinDelta = 1;
  private readonly moveProgressEmitIntervalMs = 200;

  // Guards against stale runDownload() catch blocks emitting spurious errors
  // after pause/cancel/resume. Incremented on each lifecycle change.
  private runGenerations = new Map<string, number>();

  // Track timing for turbo move speed/ETA calculation
  private moveTimeState = new Map<string, { startedAt: number; smoothedSpeed: number; smoothedEta: number }>();

  // Checkpoint timing state
  private checkpointState = new Map<string, {
    timer: NodeJS.Timeout | null;
    completedChunks: number;
    lastCheckpointAt: number;
  }>();

  private environment: DownloadEnvironment = "ssd_save";
  private envDetected = false;

  constructor(stateDir: string, config: DownloaderConfig) {
    super();
    this.config = {
      saveDir: config.saveDir,
      maxConcurrentTasks: config.maxConcurrentTasks ?? 3,
      maxConnectionsPerTask: config.maxConnectionsPerTask ?? 16,
      initialConnectionsPerTask: config.initialConnectionsPerTask ?? 4,
      chunkSize: config.chunkSize ?? DEFAULT_CHUNK_SIZE,
      retryLimit: config.retryLimit ?? 3,
      retryDelay: config.retryDelay ?? 2000,
      diskBufferGB: config.diskBufferGB ?? 5,
      bandwidthLimitBps: config.bandwidthLimitBps ?? 0,
      tmpDir: config.tmpDir ?? "",
      turboMode: config.turboMode ?? false,
      skipVerify: config.skipVerify ?? false,
      turboConnectionsMultiplier: config.turboConnectionsMultiplier ?? 2.0,
      turboChunkSizeMultiplier: config.turboChunkSizeMultiplier ?? 2.0,
      insecureTLS: config.insecureTLS ?? false,
      autoResume: config.autoResume ?? true,
    };

    this.diskManager = new DiskManager();
    this.moveQueue = new MoveQueue();
    this.stateManager = new StateManager(stateDir);
    this.scheduler = new Scheduler(this.config.maxConcurrentTasks);
    this.integrity = new IntegrityChecker();

    this.scheduler.on("started", (id: string) => this.updateTaskStatus(id, "downloading"));

    // Handle any slot opening — try to fill turbo from normal, then normal from queue
    this.scheduler.on("slot_open", (_id: string, _slotType?: DownloadMode) => {
      if (this.config.turboMode) {
        this.refreshSlots();
      }
    });

    // Auto-recover on boot
    this.recoverOnStartup().catch(err => {
      console.error("[IPSWDownloader] recoverOnStartup failed:", err);
    });
  }

  // ─── Recovery ────────────────────────────────────────────────────────────────

  private async recoverOnStartup(): Promise<void> {
    const states = await this.stateManager.listAll();

    for (const state of states) {
      if (this.tasks.has(state.id)) continue; // already active

      const tmpExists = !!(state.tmpPath && fs.existsSync(state.tmpPath));
      const i10rPath = this.buildI10rPath(state.firmware, state.savePath);
      const i10rExists = fs.existsSync(i10rPath);

      // Validate based on activeOperation
      if (state.activeOperation === "download" && !tmpExists) {
        // Tmp missing — reset chunks, still recover
        for (const c of state.chunks) { c.downloaded = 0; c.completed = false; }
        state.movedChunks = [];
        this.stateManager.save(state);
      }

      if (state.activeOperation === "verify" && !tmpExists) {
        // Tmp missing during verify — cannot continue
        this.stateManager.delete(state.id);
        continue;
      }

      if (state.activeOperation === "move" && !tmpExists && !i10rExists) {
        // Both tmp and i10r missing — cannot continue
        this.stateManager.delete(state.id);
        continue;
      }

      // Create Task
      const downloadedBytes = state.chunks.reduce((s, c) => s + c.downloaded, 0);
      const task: Task = {
        id: state.id,
        firmware: state.firmware,
        progress: state.totalSize > 0 ? downloadedBytes / state.totalSize * 100 : 0,
        speed: 0,
        status: this.config.autoResume !== false ? "queued" : "paused",
        savePath: state.savePath,
        mode: state.mode ?? "normal",
      };

      this.tasks.set(state.id, task);
      this.states.set(state.id, state);
      this.diskManager.reserveSpace(state.id, state.firmware.filesize);

      // Enqueue based on autoResume
      if (this.config.autoResume !== false) {
        const wasTurbo = this.validateTurboForRecovery(state);

        if (state.activeOperation === "verify") {
          this.scheduler.enqueue({
            id: state.id,
            turboPriority: false,
            run: () => this.runVerifyAndMove(state.id),
          });
        } else if (state.activeOperation === "move") {
          this.scheduler.enqueue({
            id: state.id,
            turboPriority: false,
            run: () => this.runMoveOnly(state.id),
          });
        } else {
          this.scheduler.enqueue({
            id: state.id,
            turboPriority: wasTurbo,
            run: () => this.runDownload(state.id),
            onSlotOpen: (slotType: DownloadMode) => {
              const t = this.tasks.get(state.id);
              if (t) { t.mode = slotType; this.emit("progress", state.id, t); }
            },
          });
        }
      }

      this.emit("added", state.id, task);
    }
  }

  private validateTurboForRecovery(state: DownloadState): boolean {
    if ((state.mode ?? "normal") !== "turbo" || !this.config.turboMode) return false;

    const turboPath = this.buildTurboPath(state.firmware, state.savePath);
    if (!fs.existsSync(turboPath)) return false;

    const turboStat = fs.statSync(turboPath);
    const completedChunks = state.chunks.filter(c => c.completed);
    const lastCompleted = completedChunks.length > 0
      ? completedChunks[completedChunks.length - 1]
      : null;

    if (lastCompleted && turboStat.size >= lastCompleted.end + 1) return true;
    if (!lastCompleted && turboStat.size >= state.totalSize) return true;

    return false;
  }

  private async runVerifyAndMove(id: string): Promise<void> {
    const task = this.tasks.get(id);
    const state = this.states.get(id);
    if (!task || !state) return;

    const gen = (this.runGenerations.get(id) ?? 0) + 1;
    this.runGenerations.set(id, gen);

    try {
      // Verify
      this.updateTaskStatus(id, "verifying");
      state.activeOperation = "verify";
      task.speed = 0;
      task.eta = undefined;
      this.emitProgressNow(id, task);

      if (!this.config.skipVerify) {
        const result = await this.integrity.verify(state.tmpPath, task.firmware, ({ pct, speed, eta }) => {
          task.progress = pct;
          task.speed = speed;
          task.eta = eta;
          this.emitThrottledProgress(id, task);
        });

        if (!result.ok) {
          this.updateTaskStatus(id, "error");
          task.error = `Checksum mismatch (${result.algo}): expected ${result.expected}, got ${result.actual}`;
          this.emit("error", id, task.error, task);
          this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
          return;
        }
      }

      // Move
      await this.executeMove(id, task, state);

    } catch (err: any) {
      if (this.runGenerations.get(id) !== gen) return;
      this.updateTaskStatus(id, "error");
      task.error = err.message;
      this.emit("error", id, err.message, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
    }
  }

  private async runMoveOnly(id: string): Promise<void> {
    const task = this.tasks.get(id);
    const state = this.states.get(id);
    if (!task || !state) return;

    const gen = (this.runGenerations.get(id) ?? 0) + 1;
    this.runGenerations.set(id, gen);

    try {
      await this.executeMove(id, task, state);
    } catch (err: any) {
      if (this.runGenerations.get(id) !== gen) return;
      this.updateTaskStatus(id, "error");
      task.error = err.message;
      this.emit("error", id, err.message, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
    }
  }

  private async executeMove(id: string, task: Task, state: DownloadState): Promise<void> {
    const isHDD = !(await this.diskManager.detectSSD(task.savePath));
    const finalPath = this.buildFinalPath(task.firmware, task.savePath);
    const i10rPath = this.buildI10rPath(task.firmware, task.savePath);

    this.updateTaskStatus(id, "moving");
    state.activeOperation = "move";
    this.doCheckpoint(id);

    task.progress = 0;
    task.speed = 0;
    task.eta = undefined;
    this.emitProgressNow(id, task);

    // Move tmp → .ipsw.i10r
    const isTurbo = task.mode === "turbo";
    await this.moveQueue.enqueue(state.tmpPath, i10rPath, isHDD, isTurbo, ({ pct, speed, eta }) => {
      task.progress = pct;
      task.speed = speed;
      task.eta = eta;
      this.emitThrottledProgress(id, task);
    });

    // Rename .ipsw.i10r → .ipsw
    try { fs.unlinkSync(finalPath); } catch {}
    fs.renameSync(i10rPath, finalPath);

    // Done
    task.progress = 100;
    task.speed = 0;
    task.eta = 0;
    this.updateTaskStatus(id, "completed");
    this.emitProgressNow(id, task);
    this.emit("completed", id, task);
    this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: false });
  }

  // ─── Environment detection ─────────────────────────────────────────────────

  private async ensureEnvironment(savePath: string): Promise<DownloadEnvironment> {
    if (this.envDetected) return this.environment;

    const isSSD = await this.diskManager.detectSSD(savePath);
    if (isSSD) {
      this.environment = "ssd_save";
    } else {
      // HDD — check if SSD tmp is available (chooseTmpDir returns null when only HDDs qualify)
      const tmpDir = await this.diskManager.chooseTmpDir(savePath, 1 * GB, 1 * GB, this.config.tmpDir || undefined);
      if (tmpDir !== null) {
        this.environment = "hdd_ssd_tmp";
      } else {
        this.environment = "hdd_only";
      }
    }

    this.envDetected = true;

    this.scheduler.setTurboMode(this.config.turboMode, this.environment);

    // On pure HDD, throttle move concurrency to avoid saturating IO
    if (this.environment === "hdd_only") {
      this.moveQueue.setHddLimit(1);
    }

    return this.environment;
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  async add(firmware: Firmware, config: DownloadRequestConfig = {}): Promise<AddResult> {
    const saveDir = this.config.saveDir;
    if (!saveDir || !fs.existsSync(saveDir)) return { success: false, error: "INVALID_SAVE_PATH" };
    try { new URL(firmware.url); } catch { return { success: false, error: "INVALID_URL" }; }

    // ── Resume via taskId ──
    if (config.taskId) {
      const existingState = this.stateManager.load(config.taskId);
      if (existingState) {
        if (this.tasks.has(config.taskId)) {
          return { success: false, error: "ALREADY_IN_LIST" };
        }

        if (config.deleteFiles?.length) {
          for (const file of config.deleteFiles) {
            if (file?.path && fs.existsSync(file.path)) {
              try { fs.unlinkSync(file.path); } catch { }
            }
          }
        }

        // ── Turbo recovery: validate .turbo, keep if usable ──
        let wasTurbo = false;
        if ((existingState.mode ?? "normal") === "turbo" && this.config.turboMode) {
          const turboPath = this.buildTurboPath(existingState.firmware, existingState.savePath);
          if (fs.existsSync(turboPath)) {
            const turboStat = fs.statSync(turboPath);
            const completedChunks = existingState.chunks.filter(c => c.completed);
            const lastCompleted = completedChunks.length > 0
              ? completedChunks[completedChunks.length - 1]
              : null;
            if (lastCompleted && turboStat.size >= lastCompleted.end + 1) {
              wasTurbo = true;
            } else if (!lastCompleted && turboStat.size >= existingState.totalSize) {
              wasTurbo = true;
            } else {
              try { fs.unlinkSync(turboPath); } catch { }
              existingState.mode = "normal";
              existingState.movedChunks = [];
              this.stateManager.save(existingState);
            }
          } else {
            existingState.mode = "normal";
            existingState.movedChunks = [];
            this.stateManager.save(existingState);
          }
        }

        // Check tmp still exists — reset chunks if missing
        const tmpExists = !!(existingState.tmpPath && fs.existsSync(existingState.tmpPath));
        if (!tmpExists) {
          for (const chunk of existingState.chunks) {
            chunk.downloaded = 0;
            chunk.completed = false;
          }
          existingState.movedChunks = [];
          this.stateManager.save(existingState);

          // Tmp is gone — we need enough space for a full fresh download + buffer
          const spaceCheck = await this.diskManager.hasEnoughSpace(
            existingState.savePath,
            existingState.firmware.filesize,
            this.config.diskBufferGB * GB,
          );
          if (!spaceCheck.ok) {
            return { success: false, error: spaceCheck.unknown ? "UNKNOWN_DISK_SPACE" : "DISK_FULL" };
          }
        }

        await this.ensureEnvironment(existingState.savePath);

        // If resuming a turbo task and all turbo slots are full, preempt
        if (wasTurbo && !this.scheduler.hasFreeTurboSlot()) {
          this.preemptForTurboSlot();
        }

        this.diskManager.reserveSpace(config.taskId, existingState.firmware.filesize);

        const downloadedBytes = existingState.chunks.reduce((s, c) => s + c.downloaded, 0);
        const resumeTask: Task = {
          id: config.taskId,
          firmware: existingState.firmware,
          progress: existingState.totalSize > 0
            ? (downloadedBytes / existingState.totalSize * 100)
            : 0,
          speed: 0,
          status: "queued",
          savePath: existingState.savePath,
          mode: "normal",
        };

        this.tasks.set(config.taskId, resumeTask);
        this.states.set(config.taskId, existingState);

        this.scheduler.enqueue({
          id: config.taskId,
          turboPriority: wasTurbo,
          run: () => this.runDownload(config.taskId!),
          onSlotOpen: (slotType: DownloadMode) => {
            const t = this.tasks.get(config.taskId!);
            if (t) {
              t.mode = slotType;
              this.emit("progress", config.taskId!, t);
            }
          },
        });

        this.emit("added", config.taskId, resumeTask);

        // Rebalance — added turbo task may need a slot
        if (this.config.turboMode) {
          setImmediate(() => this.refreshSlots());
        }

        return { success: true, id: config.taskId };
      }
      // State not found → fall through to normal add
    }

    for (const task of this.tasks.values()) {
      if (
        task.firmware.identifier === firmware.identifier &&
        task.firmware.buildid === firmware.buildid &&
        (task.status === 'downloading' || task.status === 'moving' || task.status === 'verifying' || task.status === 'queued' || task.status === 'paused')
      ) return { success: false, error: "ALREADY_IN_LIST" };
    }

    const spaceCheck = await this.diskManager.hasEnoughSpace(
      saveDir, firmware.filesize, this.config.diskBufferGB * GB, config.deleteFiles ?? []
    );
    if (!spaceCheck.ok) {
      return { success: false, error: spaceCheck.unknown ? "UNKNOWN_DISK_SPACE" : "DISK_FULL" };
    }

    if (config.deleteFiles?.length) {
      for (const file of config.deleteFiles) {
        if (file?.path && fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch { }
        }
      }
    }

    // Detect environment on first add
    await this.ensureEnvironment(saveDir);

    const id = randomUUID();
    this.diskManager.reserveSpace(id, firmware.filesize);

    // Nếu có turbo slot trống, enqueue với turboPriority để đi thẳng vào turbo
    const hasFreeTurbo = this.config.turboMode && this.scheduler.hasFreeTurboSlot();
    const task: Task = { id, firmware, progress: 0, speed: 0, status: "queued", savePath: saveDir, mode: "normal" };
    this.tasks.set(id, task);

    this.scheduler.enqueue({
      id,
      turboPriority: hasFreeTurbo,
      run: () => this.runDownload(id),
      onSlotOpen: (slotType: DownloadMode) => {
        const t = this.tasks.get(id);
        if (t) {
          t.mode = slotType;
          this.emit("progress", id, t);
        }
      },
    });
    this.emit("added", id, task);
    return { success: true, id };
  }

  pause(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    // Reject pause during final move / verify
    if (task.status === "moving" || task.status === "verifying") {
      return { success: false, error: "INVALID_STATUS" };
    }

    // Pausing an already-paused task is a no-op success
    if (task.status === "paused") return { success: true };

    // Allow pausing queued tasks
    if (task.status === "queued") {
      this.scheduler.pauseTask(id);
      this.updateTaskStatus(id, "paused");
      this.emit("paused", id, task);
      return { success: true };
    }

    if (task.status !== "downloading") return { success: false, error: "INVALID_STATUS" };

    // Bump generation so the old runDownload catch block is silenced
    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    const cm = this.chunkManagers.get(id);
    if (cm) cm.abort();

    // Checkpoint state before pausing
    this.doCheckpoint(id);

    this.scheduler.pauseTask(id);
    this.updateTaskStatus(id, "paused");
    this.emit("paused", id, task);
    return { success: true };
  }

  resume(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    // Resuming a queued or downloading task is a no-op success
    if (task.status === "queued" || task.status === "downloading") return { success: true };
    if (task.status !== "paused") return { success: false, error: "INVALID_STATUS" };

    // Bump generation so any lingering old runDownload catch block is silenced
    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    const wasTurbo = task.mode === "turbo" && this.config.turboMode;

    // Reset mode — onSlotOpen will reassign based on actual slot type
    task.mode = "normal";

    // If resuming a turbo task and all turbo slots are full, preempt
    // to make room.
    if (wasTurbo && !this.scheduler.hasFreeTurboSlot()) {
      this.preemptForTurboSlot();
    }

    this.updateTaskStatus(id, "queued");
    // Task is already in queue from pauseTask — update its entry with turbo priority
    // and the latest onSlotOpen callback.
    this.scheduler.updateQueueEntry(id, {
      turboPriority: wasTurbo,
      onSlotOpen: (slotType: DownloadMode) => {
        const t = this.tasks.get(id);
        if (t) {
          t.mode = slotType;
          this.emit("progress", id, t);
        }
      },
    });
    this.scheduler.resumeTask(id);
    this.emit("resumed", id, this.tasks.get(id)!);

    if (this.config.turboMode) {
      setImmediate(() => this.refreshSlots());
    }

    return { success: true };
  }

  /**
   * Make room for a turbo task. If a normal slot is already free, simply
   * demote one turbo task to normal. Otherwise preempt the downloading task
   * with the lowest progress and demote a turbo task to the freed slot.
   */
  private preemptForTurboSlot(): void {
    // If a normal slot is already free, just demote one turbo task — no pause needed.
    if (this.scheduler.hasFreeNormalSlot()) {
      const turboIds = this.scheduler.getActiveTurboIds();
      if (turboIds.length > 0) {
        this.demoteTurboTask(turboIds[0]);
      }
      return;
    }

    // No free normal slot — find the downloading task with the lowest progress
    // and pause it to free a slot, then demote a turbo task into it.
    const allIds = [
      ...this.scheduler.getActiveNormalDownloadingIds(),
      ...this.scheduler.getActiveTurboIds(),
    ];
    let victimId: string | null = null;
    let lowestProgress = 100;
    for (const nid of allIds) {
      const nt = this.tasks.get(nid);
      if (nt && nt.status === "downloading" && nt.progress < lowestProgress) {
        lowestProgress = nt.progress;
        victimId = nid;
      }
    }
    if (!victimId) return;

    const victimMode = this.tasks.get(victimId)?.mode;
    this.pause(victimId);

    // If the victim was normal, we freed a normal slot but the turbo slot
    // is still occupied. Demote a turbo task to the freed normal slot.
    if (victimMode === "normal" && !this.scheduler.hasFreeTurboSlot()) {
      const turboIds = this.scheduler.getActiveTurboIds();
      if (turboIds.length > 0) {
        this.demoteTurboTask(turboIds[0]);
      }
    }
  }

  /** Demote a turbo task to a normal slot (normal slot must be free). */
  private demoteTurboTask(demoteId: string): void {
    if (!this.scheduler.demoteTurboToNormal(demoteId)) return;
    const demotedTask = this.tasks.get(demoteId);
    if (!demotedTask) return;
    demotedTask.mode = "normal";
    const demotedCm = this.chunkManagers.get(demoteId);
    if (demotedCm) {
      const isHDD = this.environment !== "ssd_save";
      const baseMaxConn = isHDD
        ? Math.min(8, this.config.maxConnectionsPerTask)
        : this.config.maxConnectionsPerTask;
      demotedCm.updateMaxConnections(baseMaxConn);
    }
    this.emit("progress", demoteId, demotedTask);
  }

  cancel(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    // Reject cancel during final move / verify to avoid corrupt state
    if (task.status === "moving" || task.status === "verifying") {
      return { success: false, error: "INVALID_STATUS" };
    }

    // Cancelling an already cancelled / completed / errored task is no-op success
    if (task.status === "cancelled" || task.status === "completed" || task.status === "error") {
      return { success: true };
    }

    // Bump generation so the old runDownload catch block is silenced
    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    this.updateTaskStatus(id, "cancelled" as TaskStatus);

    const cm = this.chunkManagers.get(id);
    if (cm) {
      cm.cleanupTurboFile();
      cm.abort();
    }

    this.scheduler.cancelTask(id);
    this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });

    this.emit("cancelled", id);

    // Rebalance — cancelled task may have freed a turbo/normal slot
    if (this.config.turboMode) {
      setImmediate(() => this.refreshSlots());
    }

    return { success: true };
  }

  getAllTask(): Task[] {
    for (const [id, cm] of this.chunkManagers.entries()) {
      const task = this.tasks.get(id);
      if (task && task.status === "downloading") task.speed = cm.getStableSpeed();
    }
    return Array.from(this.tasks.values());
  }

  getIncompleteTasks(): IncompleteTask[] {
    return this.stateManager.listAll()
      .filter(s => !this.tasks.has(s.id))
      .map(s => {
        const downloadedBytes = s.chunks.reduce((sum, c) => sum + c.downloaded, 0);
        const progress = s.totalSize > 0 ? (downloadedBytes / s.totalSize * 100) : 0;
        return {
          id: s.id,
          firmware: s.firmware,
          savePath: s.savePath,
          tmpPath: s.tmpPath,
          totalSize: s.totalSize,
          downloadedBytes,
          progress,
          tmpExists: s.tmpPath ? fs.existsSync(s.tmpPath) : false,
          savedAt: s.updatedAt,
          mode: s.mode ?? "normal",
          movedChunks: s.movedChunks ?? [],
        } satisfies IncompleteTask;
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async resumeIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
    if (this.tasks.has(id)) return { success: false, error: "ALREADY_ACTIVE" };

    const state = this.stateManager.load(id);
    if (!state) return { success: false, error: "STATE_NOT_FOUND" };

    // ── Turbo crash recovery: validate .turbo, keep if usable ──
    let wasTurbo = false;
    if ((state.mode ?? "normal") === "turbo" && this.config.turboMode) {
      const turboPath = this.buildTurboPath(state.firmware, state.savePath);
      if (fs.existsSync(turboPath)) {
        const turboStat = fs.statSync(turboPath);
        const completedChunks = state.chunks.filter(c => c.completed);
        const lastCompleted = completedChunks.length > 0
          ? completedChunks[completedChunks.length - 1]
          : null;
        if (lastCompleted && turboStat.size >= lastCompleted.end + 1) {
          wasTurbo = true;
        } else if (!lastCompleted && turboStat.size >= state.totalSize) {
          wasTurbo = true;
        } else {
          try { fs.unlinkSync(turboPath); } catch { }
          state.mode = "normal";
          state.movedChunks = [];
          this.stateManager.save(state);
        }
      } else {
        state.mode = "normal";
        state.movedChunks = [];
        this.stateManager.save(state);
      }
    }

    // Check tmp still exists
    const tmpExists = !!(state.tmpPath && fs.existsSync(state.tmpPath));

    if (!tmpExists) {
      console.log(
        `[IPSWDownloader] resumeIncomplete(${id}): tmp file not found at "${state.tmpPath}", ` +
        `resetting ${state.chunks.length} chunks for a fresh download.`
      );
      for (const chunk of state.chunks) {
        chunk.downloaded = 0;
        chunk.completed = false;
      }
      state.movedChunks = [];
      this.stateManager.save(state);
    }

    // If tmp is missing and chunks are reset, require space for full download + buffer
    if (!tmpExists) {
      const spaceCheck = await this.diskManager.hasEnoughSpace(
        state.savePath,
        state.firmware.filesize,
        this.config.diskBufferGB * GB,
      );
      if (!spaceCheck.ok) {
        return { success: false, error: spaceCheck.unknown ? "UNKNOWN_DISK_SPACE" : "DISK_FULL" };
      }
    }

    // If resuming a turbo incomplete task and all turbo slots are full, preempt
    if (wasTurbo && !this.scheduler.hasFreeTurboSlot()) {
      this.preemptForTurboSlot();
    }

    const downloadedBytes = state.chunks.reduce((s, c) => s + c.downloaded, 0);

    const task: Task = {
      id,
      firmware: state.firmware,
      progress: state.totalSize > 0
        ? (downloadedBytes / state.totalSize * 100)
        : 0,
      speed: 0,
      status: "queued",
      savePath: state.savePath,
      mode: "normal", // Reset — scheduler re-decides slot assignment
    };

    this.tasks.set(id, task);
    this.states.set(id, state);
    this.diskManager.reserveSpace(id, state.firmware.filesize);

    this.scheduler.enqueue({
      id,
      turboPriority: wasTurbo,
      run: () => this.runDownload(id),
      onSlotOpen: (slotType: DownloadMode) => {
        const t = this.tasks.get(id);
        if (t) {
          t.mode = slotType;
          this.emit("progress", id, t);
        }
      },
    });
    this.emit("added", id, task);

    return { success: true };
  }

  deleteIncomplete(id: string): { success: boolean; error?: string } {
    if (this.tasks.has(id)) return { success: false, error: "USE_CANCEL_FOR_ACTIVE_TASK" };

    const state = this.stateManager.load(id);
    if (!state) return { success: false, error: "STATE_NOT_FOUND" };

    if (state.tmpPath && fs.existsSync(state.tmpPath)) {
      try { fs.unlinkSync(state.tmpPath); } catch { }
    }

    // Clean up .turbo file if it exists
    const turboPath = this.buildTurboPath(state.firmware, state.savePath);
    if (fs.existsSync(turboPath)) {
      try { fs.unlinkSync(turboPath); } catch { }
    }

    this.stateManager.delete(id);
    this.emit("incomplete_deleted", id);
    return { success: true };
  }

  getTask(id: string): Task | undefined { return this.tasks.get(id); }

  /** Return disk environment info for a given folder (usable before any download starts). */
  async getEnvironmentInfo(savePath: string): Promise<DiskEnvironmentInfo> {
    return this.diskManager.getEnvironmentInfo(savePath);
  }

  // ─── Promotion logic ────────────────────────────────────────────────────────

  /** Called after any state change to rebalance slots. */
  private refreshSlots(): void {
    if (!this.config.turboMode) return;
    this.tryPromoteNormalToTurbo();
  }

  private tryPromoteNormalToTurbo(): void {
    if (!this.config.turboMode) return;
    if (!this.scheduler.hasFreeTurboSlot()) return;

    const freeSlots = this.scheduler.getMaxTurbo() - this.scheduler.getActiveTurboCount();
    const normalIds = this.scheduler.getActiveNormalDownloadingIds();

    const candidates: string[] = [];
    for (const id of normalIds) {
      const task = this.tasks.get(id);
      if (task && task.status === "downloading") {
        candidates.push(id);
        if (candidates.length >= freeSlots) break;
      }
    }

    if (candidates.length > 0) {
      // Promote all eligible tasks in parallel
      Promise.allSettled(candidates.map(id =>
        this.promoteTask(id).catch(err => {
          console.error(`[IPSWDownloader] promoteTask(${id}) failed:`, err);
        })
      ));
      return;
    }

    // No normal downloading task available for promotion.
    // Pull from queue directly into any remaining free turbo slots.
    while (this.scheduler.hasFreeTurboSlot()) {
      if (!this.scheduler.tryFillTurboSlotFromQueue()) break;
    }
  }
  private async promoteTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status !== "downloading") return;

    const cm = this.chunkManagers.get(id);
    if (!cm) return;

    const state = this.states.get(id) ?? this.stateManager.load(id);
    if (!state) return;

    const turboPath = this.buildTurboPath(task.firmware, task.savePath);

    // Determine turbo connection count
    const isHDD = !(await this.diskManager.detectSSD(task.savePath));
    const baseMaxConn = isHDD
      ? Math.min(8, this.config.maxConnectionsPerTask)
      : this.config.maxConnectionsPerTask;
    const turboMaxConn = Math.round(baseMaxConn * this.config.turboConnectionsMultiplier);

    // Promote in scheduler first (atomically moves slot)
    const promoted = this.scheduler.promoteNormalToTurbo(id);
    if (!promoted) return;

    // Pause → Flush → Switch → Resume
    await cm.promote(state.tmpPath, turboPath);
    cm.updateMaxConnections(turboMaxConn);

    // Update task mode (both in-memory and persisted state for crash recovery)
    task.mode = "turbo";
    state.mode = "turbo";
    this.stateManager.save(state);
    this.emit("progress", id, task);

    // Fill the freed normal slot from queue
    this.scheduler.drain();

    // Cascade: if another turbo slot is free, promote again
    if (this.scheduler.hasFreeTurboSlot()) {
      setImmediate(() => this.refreshSlots());
    }
  }

  // ─── DOWNLOAD ORCHESTRATION ──────────────────────────────────────────────────

  private async runDownload(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    // Capture generation to guard against stale catch blocks
    const gen = (this.runGenerations.get(id) ?? 0) + 1;
    this.runGenerations.set(id, gen);

    try {
      this.updateTaskStatus(id, "downloading");
      this.emit("started", id, task);

      // Step 1: HEAD metadata
      const meta = await ChunkManager.fetchMetadata(task.firmware.url);

      // Step 2: Choose tmp directory
      const isHDD = !(await this.diskManager.detectSSD(task.savePath));
      const tmpDir = await this.diskManager.chooseTmpDir(
        task.savePath, task.firmware.filesize, task.firmware.filesize, this.config.tmpDir || undefined
      );
      const effectiveTmpDir = tmpDir ?? path.dirname(path.resolve(task.savePath));
      const tmpDirFinal = path.join(effectiveTmpDir, "ipswManagerTmp");
      if (!fs.existsSync(tmpDirFinal)) fs.mkdirSync(tmpDirFinal, { recursive: true });
      const tmpFile = path.join(tmpDirFinal, `${id}.ipsw.tmp`);

      // Step 3: Load or create state
      let state = this.stateManager.load(id);
      if (!state) {
        state = this.buildState(id, task.firmware, task.savePath, tmpFile, meta, task.mode);
        this.stateManager.save(state);
      }
      this.states.set(id, state);

      // Initialize checkpoint state
      this.initCheckpoint(id);

      // Step 4: Determine connection count based on mode
      const baseMaxConn = isHDD
        ? Math.min(8, this.config.maxConnectionsPerTask)
        : this.config.maxConnectionsPerTask;

      const maxConn = task.mode === "turbo"
        ? Math.round(baseMaxConn * this.config.turboConnectionsMultiplier)
        : baseMaxConn;

      const chunkSize = task.mode === "turbo"
        ? Math.round(this.config.chunkSize * this.config.turboChunkSizeMultiplier)
        : this.config.chunkSize;

      // Step 5: Set up turbo HDD+SSD progressive write if applicable
      let turboHddSsd: ChunkManagerOptions["turboHddSsd"];
      if (this.config.turboMode && isHDD && this.environment === "hdd_ssd_tmp" && task.mode === "turbo") {
        const turboPath = this.buildTurboPath(task.firmware, task.savePath);
        turboHddSsd = {
          turboPath,
          onTurboMove: (_info) => {
            // During progressive move, update task progress based on move
            // Only relevant after download completes
          },
          onTurboHddError: (err: Error) => {
            // HDD failed — degrade to SSD-only
            console.error(`[IPSWDownloader] Turbo HDD error for ${id}:`, err.message);
          },
        };
      }

      // Step 5.5: Create StreamHasher for stream verify
      let streamHasher: StreamHasher | undefined;
      if (!this.config.skipVerify) {
        const algo = task.firmware.md5sum ? "md5"
          : task.firmware.sha1sum ? "sha1"
          : task.firmware.sha256sum ? "sha256"
          : undefined;
        if (algo) streamHasher = new StreamHasher(algo);
      }

      // Step 6: Create ChunkManager
      const cm = new ChunkManager(state, this.stateManager, {
        maxConnections: maxConn,
        initialConnections: this.config.initialConnectionsPerTask,
        chunkSize,
        retryLimit: this.config.retryLimit,
        retryDelay: this.config.retryDelay,
        bandwidthLimitBps: this.config.bandwidthLimitBps,
        isHDD,
        turboConnectionsMultiplier: this.config.turboConnectionsMultiplier,
        turboHddSsd,
        insecureTLS: this.config.insecureTLS,
        streamHasher,
      });
      this.chunkManagers.set(id, cm);

      // When a normal task starts, try to promote it to turbo immediately
      // if a turbo slot is free. Runs concurrently with cm.start().
      if (this.config.turboMode && task.mode === "normal" && this.scheduler.hasFreeTurboSlot()) {
        setImmediate(() => {
          this.promoteTask(id).catch(err =>
            console.error(`[IPSWDownloader] Initial promoteTask(${id}) failed:`, err)
          );
        });
      }

      // Handle turbo HDD errors → degrade
      cm.on("turboHddError", async (_err) => {
        await cm.stopIOWorker();
        // Continue downloading to SSD tmp only, will use normal MoveQueue after
      });

      const TURBO_MOVE_ALPHA = 0.15;
      cm.on("turboMove", (info) => {
        // During move phase, use movedBytes for progress with speed/ETA
        if (task.status === "moving") {
          task.progress = info.totalSize > 0
            ? Math.min(99, (info.totalMovedBytes / info.totalSize) * 100)
            : task.progress;

          // Speed/ETA via EMA smoothing (same approach as MoveQueue)
          const mts = this.moveTimeState.get(id) ?? { startedAt: Date.now(), smoothedSpeed: 0, smoothedEta: 0 };
          if (!this.moveTimeState.has(id)) this.moveTimeState.set(id, mts);

          const elapsed = Math.max((Date.now() - mts.startedAt) / 1000, 0.001);
          const rawSpeed = info.totalMovedBytes / elapsed;
          const remaining = Math.max(info.totalSize - info.totalMovedBytes, 0);
          const rawEta = rawSpeed > 0 ? remaining / rawSpeed : 0;

          mts.smoothedSpeed = mts.smoothedSpeed === 0
            ? rawSpeed
            : mts.smoothedSpeed * (1 - TURBO_MOVE_ALPHA) + rawSpeed * TURBO_MOVE_ALPHA;

          mts.smoothedEta = mts.smoothedEta === 0
            ? rawEta
            : mts.smoothedEta * (1 - TURBO_MOVE_ALPHA) + rawEta * TURBO_MOVE_ALPHA;

          task.speed = Math.round(mts.smoothedSpeed);
          task.eta = Math.max(0, Math.round(mts.smoothedEta));

          this.emitThrottledProgress(id, task);
        }
      });

      cm.on("progress", (p) => {
        const downloaded = p.bytesWritten;
        const total = p.totalBytes > 0 ? p.totalBytes : state!.totalSize;
        task.progress = Math.min(99, (downloaded / total) * 100);
        task.speed = cm.getStableSpeed();
        task.eta = cm.getStableEta(total, downloaded);
        this.emitThrottledProgress(id, task);
      });

      cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));

      // Chunk completion → checkpoint scheduling
      cm.on("chunkComplete", (_index: number) => {
        this.scheduleCheckpoint(id);
      });

      // Step 7: Download
      await cm.start(tmpFile);

      if (task.status === "paused" || task.status === "cancelled") return;

      // Step 8: Verify integrity
      if (!this.config.skipVerify) {
        // Checkpoint before verify
        state.activeOperation = "verify";
        this.doCheckpoint(id);

        this.updateTaskStatus(id, "verifying");
        task.speed = 0;
        task.eta = undefined;
        this.emitProgressNow(id, task);

        if (streamHasher) {
          // Stream hash was computed during download — use it directly
          const computed = streamHasher.finalize();
          const expected = streamHasher.getAlgo() === "md5" ? task.firmware.md5sum
            : streamHasher.getAlgo() === "sha1" ? task.firmware.sha1sum
            : task.firmware.sha256sum;

          if (computed.toLowerCase() !== (expected ?? "").toLowerCase()) {
            this.updateTaskStatus(id, "error");
            task.error = `Checksum mismatch (${streamHasher.getAlgo()}): expected ${expected}, got ${computed}`;
            this.emit("error", id, task.error, task);
            cm.cleanupTurboFile();
            this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
            return;
          }
          // Hash OK — skip native verify
        } else {
          // No stream hash — fallback to native verify
          let lastVerifyEmitAt = 0;
          const result = await this.integrity.verify(tmpFile, task.firmware, ({ pct, speed, eta }) => {
            task.progress = pct;
            task.speed = speed;
            task.eta = eta;

            const now = Date.now();
            if (now - lastVerifyEmitAt >= this.moveProgressEmitIntervalMs || pct === 100) {
              lastVerifyEmitAt = now;
              this.emitThrottledProgress(id, task);
              return;
            }

            this.emitThrottledProgress(id, task);
          });

          if (!result.ok) {
            this.updateTaskStatus(id, "error");
            task.error = `Checksum mismatch (${result.algo}): expected ${result.expected}, got ${result.actual}`;
            this.emit("error", id, task.error, task);
            cm.cleanupTurboFile();
            this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
            return;
          }
        }
      }

      // Step 9: Move tmp → .ipsw.i10r → final (or finish progressive turbo move)
      const finalPath = this.buildFinalPath(task.firmware, task.savePath);
      const i10rPath = this.buildI10rPath(task.firmware, task.savePath);

      // Checkpoint before move
      state.activeOperation = "move";
      this.doCheckpoint(id);

      if (cm.isTurboHddSsd()) {
        // Turbo HDD+SSD: chunks were progressively moved to .turbo during
        // download. Drain remaining queued chunks, then rename .turbo → .ipsw.i10r → final.
        this.updateTaskStatus(id, "moving");

        // Start progress from already-moved bytes (not 0)
        const initialMoved = cm.getTotalMovedBytes();
        task.progress = state.totalSize > 0
          ? (initialMoved / state.totalSize * 100)
          : 0;
        task.speed = 0;
        task.eta = undefined;
        this.emitProgressNow(id, task);

        // Drain — wait for ALL queued chunks to finish moving
        // turboMove events update task.progress during the drain
        await cm.drainIOWorker();

        // Final progress from moved bytes (accurate, not based on download %)
        const totalMoved = cm.getTotalMovedBytes();
        task.progress = state.totalSize > 0
          ? Math.min(99, (totalMoved / state.totalSize * 100))
          : 100;
        this.emitThrottledProgress(id, task);

        const turboPath = cm.getTurboPath()!;

        // Drain guarantees all chunks are in .turbo — rename directly
        try { fs.unlinkSync(i10rPath); } catch { }
        fs.renameSync(turboPath, i10rPath);
        try { fs.unlinkSync(finalPath); } catch { }
        fs.renameSync(i10rPath, finalPath);
      } else {
        // Normal path (or turbo on SSD / HDD-only): MoveQueue
        this.updateTaskStatus(id, "moving");
        task.progress = 0;
        task.speed = 0;
        task.eta = undefined;
        this.emitProgressNow(id, task);

        const isTurbo = task.mode === "turbo";
        await this.moveQueue.enqueue(tmpFile, i10rPath, isHDD, isTurbo, ({ pct, speed, eta }) => {
          task.progress = pct;
          task.speed = speed;
          task.eta = eta;
          this.emitThrottledProgress(id, task);
        });
        try { fs.unlinkSync(finalPath); } catch { }
        fs.renameSync(i10rPath, finalPath);
      }

      // Done
      task.progress = 100;
      task.speed = 0;
      task.eta = 0;
      this.updateTaskStatus(id, "completed");
      this.emitProgressNow(id, task);
      this.emit("completed", id, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: false });

    } catch (err: any) {
      // Stale runDownload — pause/cancel/resume bumped the generation
      if (this.runGenerations.get(id) !== gen) return;

      this.updateTaskStatus(id, "error");
      task.error = err.message;
      this.emit("error", id, err.message, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Scale chunk size with file size to keep chunk count reasonable for large files. */
  private computeAdaptiveChunkSize(fileSize: number): number {
    const gb = 1024 * 1024 * 1024;
    if (fileSize < 1 * gb) return 16 * 1024 * 1024;    // 16 MB
    if (fileSize < 4 * gb) return 32 * 1024 * 1024;    // 32 MB
    if (fileSize < 10 * gb) return 64 * 1024 * 1024;   // 64 MB
    if (fileSize < 20 * gb) return 128 * 1024 * 1024;  // 128 MB
    return 256 * 1024 * 1024;                           // 256 MB
  }

  private buildState(
    id: string,
    firmware: Firmware,
    savePath: string,
    tmpPath: string,
    meta: { contentLength: number; acceptsRanges: boolean },
    mode: DownloadMode = "normal",
  ): DownloadState {
    const totalSize = meta.contentLength || firmware.filesize;
    const supportsRanges = meta.acceptsRanges;
    if (totalSize <= 0) {
      return {
        id, firmware, savePath, tmpPath,
        totalSize: 0,
        chunks: [{ index: 0, start: 0, end: 0, downloaded: 0, completed: true }],
        supportsRanges,
        createdAt: Date.now(), updatedAt: Date.now(),
        mode,
        movedChunks: [],
        activeOperation: "download",
        lastCheckpoint: Date.now(),
        lastWriteTime: 0,
      };
    }

    const chunks: ChunkState[] = [];

    if (supportsRanges) {
      const baseChunkSize = this.computeAdaptiveChunkSize(totalSize);
      const effectiveChunkSize = mode === "turbo"
        ? Math.round(baseChunkSize * this.config.turboChunkSizeMultiplier)
        : baseChunkSize;

      let offset = 0, index = 0;
      while (offset < totalSize) {
        const end = Math.min(offset + effectiveChunkSize - 1, totalSize - 1);
        chunks.push({ index, start: offset, end, downloaded: 0, completed: false });
        offset = end + 1;
        index++;
      }
    } else {
      chunks.push({ index: 0, start: 0, end: totalSize - 1, downloaded: 0, completed: false });
    }

    return {
      id, firmware, savePath, tmpPath, totalSize, chunks, supportsRanges,
      createdAt: Date.now(), updatedAt: Date.now(),
      mode,
      movedChunks: [],
      activeOperation: "download",
      lastCheckpoint: Date.now(),
      lastWriteTime: 0,
    };
  }

  private buildFinalPath(firmware: Firmware, savePath: string): string {
    const filename = this.extractFilename(firmware);
    if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
      return path.join(savePath, filename);
    }
    return savePath;
  }

  private buildTurboPath(firmware: Firmware, savePath: string): string {
    const filename = this.extractFilename(firmware);
    const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
      ? savePath
      : path.dirname(savePath);
    return path.join(dir, `${filename}.turbo`);
  }

  private buildI10rPath(firmware: Firmware, savePath: string): string {
    const filename = this.extractFilename(firmware);
    const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
      ? savePath
      : path.dirname(savePath);
    return path.join(dir, `${filename}.i10r`);
  }

  private scheduleCheckpoint(id: string): void {
    const cs = this.checkpointState.get(id);
    if (!cs) return;
    cs.completedChunks++;

    // 10 chunks or 30s timer
    if (cs.completedChunks >= 10) {
      this.doCheckpoint(id);
    } else if (!cs.timer) {
      cs.timer = setTimeout(() => this.doCheckpoint(id), 30_000);
    }
  }

  private doCheckpoint(id: string): void {
    const cs = this.checkpointState.get(id);
    if (cs?.timer) { clearTimeout(cs.timer); cs.timer = null; }
    if (cs) {
      cs.completedChunks = 0;
      cs.lastCheckpointAt = Date.now();
    }

    const state = this.states.get(id);
    if (state) {
      const { lastCheckpoint, lastWriteTime } = this.stateManager.saveAtomic(state);
      state.lastCheckpoint = lastCheckpoint;
      state.lastWriteTime = lastWriteTime;
    }
  }

  private initCheckpoint(id: string): void {
    this.checkpointState.set(id, {
      timer: null,
      completedChunks: 0,
      lastCheckpointAt: Date.now(),
    });
  }

  private clearCheckpoint(id: string): void {
    const cs = this.checkpointState.get(id);
    if (cs?.timer) { clearTimeout(cs.timer); cs.timer = null; }
    this.checkpointState.delete(id);
  }


  private extractFilename(firmware: Firmware): string {
    try {
      const pathname = new URL(firmware.url).pathname;
      const name = pathname.split('/').pop();
      if (name) return name;
    } catch {}
    return `${firmware.identifier}_${firmware.buildid}.ipsw`;
  }

  private updateTaskStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id);
    if (task) task.status = status;
  }

  private emitProgressNow(id: string, task: Task): void {
    const state = this.progressEmitState.get(id);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.progressEmitState.delete(id);
    this.emit("progress", id, task);
  }

  private emitThrottledProgress(id: string, task: Task): void {
    const now = Date.now();
    const prev = this.progressEmitState.get(id);
    const progressChanged = !prev || Math.abs(task.progress - prev.lastProgress) >= this.progressEmitMinDelta;
    const shouldFlushNow = !prev || progressChanged || (now - prev.lastAt) >= this.progressEmitIntervalMs;

    if (shouldFlushNow) {
      if (prev?.timer) clearTimeout(prev.timer);
      this.progressEmitState.set(id, { lastAt: now, lastProgress: task.progress, timer: null, pending: null });
      this.emit("progress", id, task);
      return;
    }

    if (!prev) return;
    prev.pending = { ...task };
    if (!prev.timer) {
      const delay = Math.max(0, this.progressEmitIntervalMs - (now - prev.lastAt));
      prev.timer = setTimeout(() => {
        const current = this.progressEmitState.get(id);
        if (!current) return;
        const pending = current.pending;
        this.progressEmitState.delete(id);
        if (pending) this.emit("progress", id, pending);
      }, delay);
    }
  }

  private cleanupRuntime(
    id: string,
    options: {
      releaseSpace: boolean;
      deleteTmpFile: boolean;
      deleteStateFile: boolean;
      deleteTask: boolean;
    }
  ): void {
    const progressState = this.progressEmitState.get(id);
    if (progressState?.timer) clearTimeout(progressState.timer);
    this.progressEmitState.delete(id);
    if (options.releaseSpace) {
      this.diskManager.releaseSpace(id);
    }

    const state = this.states.get(id) ?? this.stateManager.load(id);
    if (options.deleteTmpFile && state?.tmpPath && fs.existsSync(state.tmpPath)) {
      try { fs.unlinkSync(state.tmpPath); } catch { }
    }

    // Clean up .ipsw.i10r at savePath if exists
    if (state) {
      const i10rPath = this.buildI10rPath(state.firmware, state.savePath);
      if (fs.existsSync(i10rPath)) {
        try { fs.unlinkSync(i10rPath); } catch {}
      }
    }

    // Clean up .turbo file if it exists
    const cm = this.chunkManagers.get(id);
    if (cm) cm.cleanupTurboFile();

    if (options.deleteStateFile) {
      this.stateManager.delete(id);
    }

    this.states.delete(id);
    this.chunkManagers.delete(id);
    this.runGenerations.delete(id);
    this.moveTimeState.delete(id);
    this.clearCheckpoint(id);
    if (options.deleteTask) {
      this.tasks.delete(id);
    }
  }
}
