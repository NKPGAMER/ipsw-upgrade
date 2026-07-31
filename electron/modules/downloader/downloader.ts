import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { URL } from "url";

import {
  Task,
  TaskStatus,
  DownloadState,
  CompactChunk,
  AddResult,
  LifecycleResult,
  IncompleteTask,
  DownloadManagerOptions,
  AddOptions,
} from "@custom-type/downloader";
import { DiskManager, DiskEnvironmentInfo } from "./disk-manager";
import type { DriveCategory } from "./scheduler";
import { StateManager } from "./state-manager";
import { ChunkManager } from "./chunk-manager";
import { TaskScheduler, TransferScheduler } from "./scheduler";
import { IntegrityChecker } from "./integrity";
import { initNativeOps, startMove } from "./native-ops";

const GB = 1024 ** 3;

// ─── Performance presets ───────────────────────────────────────────────────────

const PERF_NORMAL = {
  maxConnections: 48,
  maxTaskConnections: 16,
  chunkSize: 32 * 1024 * 1024,
  writeHighWater: 8 * 1024 * 1024,
};

const PERF_HIGH = {
  maxConnections: 96,
  maxTaskConnections: 32,
  chunkSize: 64 * 1024 * 1024,
  writeHighWater: 16 * 1024 * 1024,
};

// ─── Internal config shape (flattened from DownloadManagerOptions) ────────────

interface FlatConfig {
  saveDir: string;
  stateDir: string;
  maxConnections: number;
  maxSsdTasks: number;
  maxHddTasks: number;
  maxExternalSsdTasks: number;
  maxUsbTasks: number;
  maxTransfers: number;
  useTmp: boolean;
  maxTaskConnections: number;
  taskInitConnections: number;
  autoResume: boolean;
  retryLimit: number;
  retryDelay: number;
  bandwidthLimit: number;
  insecureTLS: boolean;
  integrityEnable: boolean;
  integrityAlgorithm: "md5" | "sha1" | "sha256";
  performance: "normal" | "high";
}

function toFlatConfig(opts: DownloadManagerOptions): FlatConfig {
  const perfPreset = opts.download?.performance === "high" ? PERF_HIGH : PERF_NORMAL;
  const algoMap: Record<string, "md5" | "sha1" | "sha256"> = { MD5: "md5", SHA1: "sha1", SHA256: "sha256" };

  return {
    saveDir: opts.paths.saveDir,
    stateDir: opts.paths.stateDir,
    maxConnections: opts.network?.maxConnections ?? perfPreset.maxConnections,
    maxSsdTasks: opts.scheduler?.maxSsdTasks ?? 3,
    maxHddTasks: opts.scheduler?.maxHddTasks ?? 1,
    maxExternalSsdTasks: opts.scheduler?.maxExternalSsdTasks ?? 2,
    maxUsbTasks: opts.scheduler?.maxUsbTasks ?? 1,
    maxTransfers: opts.scheduler?.maxTransfers ?? 1,
    useTmp: opts.paths?.useTmp ?? false,
    maxTaskConnections: opts.download?.maxTaskConnections ?? perfPreset.maxTaskConnections,
    taskInitConnections: opts.download?.taskInitConnections ?? 4,
    autoResume: opts.recovery?.autoResume ?? false,
    retryLimit: opts.download?.retryLimit ?? 3,
    retryDelay: opts.download?.retryDelay ?? 2000,
    bandwidthLimit: opts.network?.bandwidthLimit ?? 0,
    insecureTLS: false,
    integrityEnable: opts.integrity?.enable ?? false,
    integrityAlgorithm: algoMap[opts.integrity?.algorithm ?? ""] ?? "sha1",
    performance: opts.download?.performance ?? "normal",
  };
}

function flatToDownloadManagerOptions(c: FlatConfig): DownloadManagerOptions {
  return {
    paths: { saveDir: c.saveDir, stateDir: c.stateDir, useTmp: c.useTmp },
    network: { maxConnections: c.maxConnections, bandwidthLimit: c.bandwidthLimit },
    scheduler: {
      maxSsdTasks: c.maxSsdTasks,
      maxHddTasks: c.maxHddTasks,
      maxExternalSsdTasks: c.maxExternalSsdTasks,
      maxUsbTasks: c.maxUsbTasks,
      maxTransfers: c.maxTransfers,
    },
    download: {
      performance: c.performance,
      maxTaskConnections: c.maxTaskConnections,
      taskInitConnections: c.taskInitConnections,
      retryLimit: c.retryLimit,
      retryDelay: c.retryDelay,
    },
    integrity: {
      enable: c.integrityEnable,
      algorithm: c.integrityAlgorithm === "md5" ? "MD5"
        : c.integrityAlgorithm === "sha256" ? "SHA256" : "SHA1",
    },
    recovery: { autoResume: c.autoResume },
  };
}

// ─── Chunk helpers ────────────────────────────────────────────────────────────

function buildFreshChunks(totalSize: number, supportsRanges: boolean, chunkSize: number): CompactChunk[] {
  if (totalSize <= 0) return [];

  if (!supportsRanges) {
    return [[0, totalSize - 1, 0]];
  }

  const chunks: CompactChunk[] = [];
  let offset = 0;
  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize - 1, totalSize - 1);
    chunks.push([offset, end, 0]);
    offset = end + 1;
  }
  return chunks;
}

function getDownloadedBytes(state: DownloadState): number {
  if (state.totalSize <= 0) return 0;
  const remaining = state.chunks.reduce((sum, c) => sum + (c[1] - c[0] + 1 - c[2]), 0);
  return state.totalSize - remaining;
}

// ─── IPSWDownloader ───────────────────────────────────────────────────────────

export class IPSWDownloader extends EventEmitter {
  private config!: FlatConfig;
  private tasks = new Map<string, Task>();
  private states = new Map<string, DownloadState>();
  private chunkManagers = new Map<string, ChunkManager>();
  private diskManager: DiskManager;
  private stateManager: StateManager;
  private taskScheduler!: TaskScheduler;
  private transferScheduler!: TransferScheduler;
  private integrity: IntegrityChecker;
  private perf!: typeof PERF_NORMAL;

  private progressEmitState = new Map<string, {
    lastAt: number;
    lastProgress: number;
    timer: NodeJS.Timeout | null;
    pending: Task | null;
  }>();
  private readonly progressEmitIntervalMs = 150;
  private readonly progressEmitMinDelta = 1;

  private runGenerations = new Map<string, number>();

  private checkpointState = new Map<string, {
    timer: NodeJS.Timeout | null;
    completedChunks: number;
    lastCheckpointAt: number;
  }>();

  constructor(opts: DownloadManagerOptions) {
    super();

    if (!opts.paths?.stateDir) throw new Error("DownloadManagerOptions.paths.stateDir is required");
    if (!opts.paths?.saveDir) throw new Error("DownloadManagerOptions.paths.saveDir is required");

    const perfPreset = opts.download?.performance === "high" ? PERF_HIGH : PERF_NORMAL;
    this.perf = perfPreset;
    this.config = toFlatConfig(opts);

    initNativeOps();

    this.diskManager = new DiskManager();
    this.stateManager = new StateManager(this.config.stateDir);

    this.taskScheduler = new TaskScheduler({
      maxSsdTasks: this.config.maxSsdTasks,
      maxHddTasks: this.config.maxHddTasks,
      maxExternalSsdTasks: this.config.maxExternalSsdTasks,
      maxUsbTasks: this.config.maxUsbTasks,
      maxConnections: this.config.maxConnections,
    });

    this.transferScheduler = new TransferScheduler(this.config.maxTransfers);

    this.integrity = new IntegrityChecker();

    this.taskScheduler.on("started", (id: string) => this.updateTaskStatus(id, "downloading"));
    this.taskScheduler.on("slot_open", () => this.taskScheduler.drain());

    this.transferScheduler.on("queued", (id: string) => {
      this.updateTaskStatus(id, "queueTransfer");
      const task = this.tasks.get(id);
      if (task) this.emitProgressNow(id, task);
    });
    this.transferScheduler.on("started", (id: string) => {
      this.updateTaskStatus(id, "transferring");
      const task = this.tasks.get(id);
      if (task) this.emitProgressNow(id, task);
    });
    this.transferScheduler.on("cancel", (id: string) => {
      const task = this.tasks.get(id);
      if (task) {
        this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
      }
    });

    this.recoverOnStartup().catch(err => {
      console.error("[IPSWDownloader] recoverOnStartup failed:", err);
    });
  }

  // ─── Recovery ────────────────────────────────────────────────────────────────

  private async recoverOnStartup(): Promise<void> {
    const states = this.stateManager.listAll();

    for (const state of states) {
      if (this.tasks.has(state.id)) continue;

      const tmpExists = !!(state.tmpPath && fs.existsSync(state.tmpPath));
      const i10rPath = this.buildI10rPath(state.firmware, state.savePath);
      const i10rExists = fs.existsSync(i10rPath);
      const fileName = state.fileName || this.extractFilename(state.firmware);
      const finalPath = path.join(state.savePath, fileName);
      const finalExists = fs.existsSync(finalPath);

      if (state.activeOperation === "download") {
        if (state.tmpPath === null) {
          if (finalExists && state.chunks.length === 0) {
            this.stateManager.delete(state.id);
            continue;
          } else if (!finalExists) {
            state.chunks = buildFreshChunks(state.totalSize, state.supportsRanges, this.perf.chunkSize);
            this.stateManager.save(state);
          }
        } else if (!tmpExists) {
          state.chunks = buildFreshChunks(state.totalSize, state.supportsRanges, this.perf.chunkSize);
          this.stateManager.save(state);
        }
      }

      if (state.activeOperation === "verify" && !tmpExists && !finalExists) {
        this.stateManager.delete(state.id);
        continue;
      }

      if (state.activeOperation === "move" && !tmpExists && !i10rExists) {
        this.stateManager.delete(state.id);
        continue;
      }

      if (!this.config.autoResume) continue;

      const downloadedBytes = getDownloadedBytes(state);
      const task: Task = {
        id: state.id,
        firmware: state.firmware,
        progress: state.totalSize > 0 ? downloadedBytes / state.totalSize * 100 : 0,
        speed: 0,
        status: "queued",
        savePath: state.savePath,
      };

      this.tasks.set(state.id, task);
      this.states.set(state.id, state);
      this.diskManager.reserveSpace(state.id, state.firmware.filesize);

      const driveCat = await this.resolveEffectiveDriveCategory(
        state.savePath, state.firmware.filesize, state.tmpPath,
      );

      if (state.activeOperation === "verify") {
        this.taskScheduler.enqueue({
          id: state.id,
          driveCategory: driveCat,
          connectionsNeeded: this.config.maxTaskConnections,
          run: () => this.runVerifyAndMove(state.id),
        });
      } else if (state.activeOperation === "move") {
        this.taskScheduler.enqueue({
          id: state.id,
          driveCategory: driveCat,
          connectionsNeeded: 0,
          run: () => this.runMoveOnly(state.id),
        });
      } else {
        this.taskScheduler.enqueue({
          id: state.id,
          driveCategory: driveCat,
          connectionsNeeded: this.config.maxTaskConnections,
          run: () => this.runDownload(state.id),
        });
      }

      this.emit("added", state.id, task);
    }
  }

  private async runVerifyAndMove(id: string): Promise<void> {
    const task = this.tasks.get(id);
    const state = this.states.get(id);
    if (!task || !state) return;

    const gen = (this.runGenerations.get(id) ?? 0) + 1;
    this.runGenerations.set(id, gen);

    try {
      this.updateTaskStatus(id, "verifying");
      state.activeOperation = "verify";
      task.speed = 0;
      task.eta = undefined;
      this.emitProgressNow(id, task);

      if (this.config.integrityEnable) {
        const algo = this.config.integrityAlgorithm;
        const expected = this.getExpectedHash(task.firmware, algo);
        const verifyPath = state.tmpPath ?? path.join(state.savePath, state.fileName || this.extractFilename(task.firmware));
        if (expected) {
          const result = await this.integrity.verify(verifyPath, algo, expected, ({ pct, speed, eta }) => {
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
      }

      if (state.tmpPath === null) {
        task.speed = 0;
        task.eta = 0;
        task.progress = 100;
        this.updateTaskStatus(id, "completed");
        this.emitProgressNow(id, task);
        this.emit("completed", id, task);
        this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: true, deleteTask: false });
      } else {
        await this.executeMove(id, task, state);
      }
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

  resolveDownloadDir(saveDir: string): string {
    return saveDir;
  }

  private async resolveEffectiveDriveCategory(
    savePath: string,
    filesize: number,
    existingTmpPath?: string | null,
  ): Promise<DriveCategory> {
    const saveCat = await this.diskManager.getDriveCategoryForPath(savePath);
    const isSaveOnSSD = saveCat === "internal_ssd" || saveCat === "external_ssd";

    if (isSaveOnSSD) return saveCat;

    if (existingTmpPath) {
      return this.diskManager.getDriveCategoryForPath(existingTmpPath);
    }

    if (this.config.useTmp) {
      const ssdTmp = await this.diskManager.findTmpDir(filesize);
      if (ssdTmp) {
        return this.diskManager.getDriveCategoryForPath(ssdTmp);
      }
    }

    return saveCat;
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  async add(firmware: Firmware, options: AddOptions = {}): Promise<AddResult> {
    const saveDir = this.config.saveDir;
    if (!saveDir || !fs.existsSync(saveDir)) return { success: false, error: "INVALID_SAVE_PATH" };
    try { new URL(firmware.url); } catch { return { success: false, error: "INVALID_URL" }; }

    // ── Resume via taskId ──
    if (options.taskId) {
      const existingState = this.stateManager.load(options.taskId);
      if (existingState) {
        if (this.tasks.has(options.taskId)) {
          return { success: false, error: "ALREADY_IN_LIST" };
        }

        const tmpExists = !!(existingState.tmpPath && fs.existsSync(existingState.tmpPath));
        if (!tmpExists) {
          existingState.chunks = buildFreshChunks(existingState.totalSize, existingState.supportsRanges, this.perf.chunkSize);
          this.stateManager.save(existingState);

          const spaceCheck = await this.diskManager.hasEnoughSpace(existingState.savePath, existingState.firmware.filesize);
          if (!spaceCheck.ok) {
            return { success: false, error: spaceCheck.unknown ? "UNKNOWN_DISK_SPACE" : "DISK_FULL" };
          }
        }

        const driveCat = await this.resolveEffectiveDriveCategory(
          existingState.savePath, existingState.firmware.filesize, existingState.tmpPath,
        );

        this.diskManager.reserveSpace(options.taskId, existingState.firmware.filesize);

        const downloadedBytes = getDownloadedBytes(existingState);
        const resumeTask: Task = {
          id: options.taskId,
          firmware: existingState.firmware,
          progress: existingState.totalSize > 0 ? (downloadedBytes / existingState.totalSize * 100) : 0,
          speed: 0,
          status: "queued",
          savePath: existingState.savePath,
        };

        this.tasks.set(options.taskId, resumeTask);
        this.states.set(options.taskId, existingState);

        this.taskScheduler.enqueue({
          id: options.taskId,
          driveCategory: driveCat,
          connectionsNeeded: this.config.maxTaskConnections,
          run: () => this.runDownload(options.taskId!),
        });

        this.emit("added", options.taskId, resumeTask);
        return { success: true, id: options.taskId };
      }
    }

    for (const task of this.tasks.values()) {
      if (
        task.firmware.identifier === firmware.identifier &&
        task.firmware.buildid === firmware.buildid &&
        (task.status === "downloading" || task.status === "transferring" ||
          task.status === "queueTransfer" || task.status === "verifying" || task.status === "queued" || task.status === "paused")
      ) return { success: false, error: "ALREADY_IN_LIST" };
    }

    const spaceCheck = await this.diskManager.hasEnoughSpace(saveDir, firmware.filesize, 5 * GB);
    if (!spaceCheck.ok) {
      return { success: false, error: spaceCheck.unknown ? "UNKNOWN_DISK_SPACE" : "DISK_FULL" };
    }

    const id = randomUUID();
    const driveCat = await this.resolveEffectiveDriveCategory(saveDir, firmware.filesize);

    this.diskManager.reserveSpace(id, firmware.filesize);

    const task: Task = { id, firmware, progress: 0, speed: 0, status: "queued", savePath: saveDir };
    this.tasks.set(id, task);

    this.taskScheduler.enqueue({
      id,
      driveCategory: driveCat,
      connectionsNeeded: this.config.maxTaskConnections,
      run: () => this.runDownload(id),
    });

    this.emit("added", id, task);
    return { success: true, id };
  }

  pause(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    if (task.status === "transferring" || task.status === "queueTransfer" || task.status === "verifying") {
      return { success: false, error: "INVALID_STATUS" };
    }

    if (task.status === "paused") return { success: true };

    if (task.status === "queued") {
      this.taskScheduler.pauseTask(id);
      this.updateTaskStatus(id, "paused");
      this.emit("paused", id, task);
      return { success: true };
    }

    if (task.status !== "downloading") return { success: false, error: "INVALID_STATUS" };

    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    const cm = this.chunkManagers.get(id);
    if (cm) cm.abort();

    this.doCheckpoint(id);

    this.taskScheduler.pauseTask(id);
    this.updateTaskStatus(id, "paused");
    this.emit("paused", id, task);
    return { success: true };
  }

  resume(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    if (task.status === "queued" || task.status === "downloading") return { success: true };
    if (task.status !== "paused") return { success: false, error: "INVALID_STATUS" };

    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    this.updateTaskStatus(id, "queued");
    this.taskScheduler.resumeTask(id);
    this.emit("resumed", id, this.tasks.get(id)!);
    return { success: true };
  }

  cancel(id: string): LifecycleResult {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: "NOT_FOUND" };

    if (task.status === "transferring" || task.status === "verifying") {
      return { success: false, error: "INVALID_STATUS" };
    }

    if (task.status === "cancelled" || task.status === "completed" || task.status === "error") {
      return { success: true };
    }

    const wasQueueTransfer = task.status === "queueTransfer";

    this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);

    this.updateTaskStatus(id, "cancelled");

    if (wasQueueTransfer) {
      this.transferScheduler.cancelTask(id);
    }

    const cm = this.chunkManagers.get(id);
    if (cm) cm.abort();

    this.taskScheduler.cancelTask(id);
    this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });

    this.emit("cancelled", id);
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
        const downloadedBytes = getDownloadedBytes(s);
        const progress = s.totalSize > 0 ? (downloadedBytes / s.totalSize * 100) : 0;
        return {
          id: s.id,
          firmware: s.firmware,
          savePath: s.savePath,
          tmpPath: s.tmpPath ?? null,
          fileName: s.fileName ?? "",
          totalSize: s.totalSize,
          downloadedBytes,
          progress,
          tmpExists: s.tmpPath ? fs.existsSync(s.tmpPath) : false,
          savedAt: s.updatedAt,
        } satisfies IncompleteTask;
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  getConfig(): DownloadManagerOptions {
    return flatToDownloadManagerOptions(this.config);
  }

  setConfig(partial: DownloadManagerOptions): void {
    const c = this.config;
    if (partial.paths) {
      if (partial.paths.saveDir !== undefined) c.saveDir = partial.paths.saveDir;
      if (partial.paths.stateDir !== undefined) c.stateDir = partial.paths.stateDir;
      if (partial.paths.useTmp !== undefined) c.useTmp = partial.paths.useTmp;
    }
    if (partial.network) {
      if (partial.network.maxConnections !== undefined) {
        c.maxConnections = partial.network.maxConnections;
        this.taskScheduler.updateConfig({ maxConnections: c.maxConnections });
      }
      if (partial.network.bandwidthLimit !== undefined) c.bandwidthLimit = partial.network.bandwidthLimit;
    }
    if (partial.scheduler) {
      if (partial.scheduler.maxSsdTasks !== undefined) {
        c.maxSsdTasks = partial.scheduler.maxSsdTasks;
        this.taskScheduler.updateConfig({ maxSsdTasks: c.maxSsdTasks });
      }
      if (partial.scheduler.maxHddTasks !== undefined) {
        c.maxHddTasks = partial.scheduler.maxHddTasks;
        this.taskScheduler.updateConfig({ maxHddTasks: c.maxHddTasks });
      }
      if (partial.scheduler.maxExternalSsdTasks !== undefined) {
        c.maxExternalSsdTasks = partial.scheduler.maxExternalSsdTasks;
        this.taskScheduler.updateConfig({ maxExternalSsdTasks: c.maxExternalSsdTasks });
      }
      if (partial.scheduler.maxUsbTasks !== undefined) {
        c.maxUsbTasks = partial.scheduler.maxUsbTasks;
        this.taskScheduler.updateConfig({ maxUsbTasks: c.maxUsbTasks });
      }
      if (partial.scheduler.maxTransfers !== undefined) {
        c.maxTransfers = partial.scheduler.maxTransfers;
        this.transferScheduler.updateMaxTransfers(c.maxTransfers);
      }
    }
    if (partial.download) {
      if (partial.download.performance !== undefined) {
        c.performance = partial.download.performance;
        const perfPreset = c.performance === "high" ? PERF_HIGH : PERF_NORMAL;
        this.perf = perfPreset;
        c.maxConnections = perfPreset.maxConnections;
        c.maxTaskConnections = perfPreset.maxTaskConnections;
      }
      if (partial.download.maxTaskConnections !== undefined) c.maxTaskConnections = partial.download.maxTaskConnections;
      if (partial.download.taskInitConnections !== undefined) c.taskInitConnections = partial.download.taskInitConnections;
      if (partial.download.retryLimit !== undefined) c.retryLimit = partial.download.retryLimit;
      if (partial.download.retryDelay !== undefined) c.retryDelay = partial.download.retryDelay;
    }
    if (partial.integrity) {
      if (partial.integrity.enable !== undefined) c.integrityEnable = partial.integrity.enable;
      if (partial.integrity.algorithm !== undefined) {
        const algoMap: Record<string, "md5" | "sha1" | "sha256"> = { MD5: "md5", SHA1: "sha1", SHA256: "sha256" };
        c.integrityAlgorithm = algoMap[partial.integrity.algorithm] ?? "sha1";
      }
    }
    if (partial.recovery) {
      if (partial.recovery.autoResume !== undefined) c.autoResume = partial.recovery.autoResume;
    }
  }

  deleteIncomplete(id: string): { success: boolean; error?: string } {
    if (this.tasks.has(id)) return { success: false, error: "USE_CANCEL_FOR_ACTIVE_TASK" };

    const state = this.stateManager.load(id);
    if (!state) return { success: false, error: "STATE_NOT_FOUND" };

    if (state.tmpPath && fs.existsSync(state.tmpPath)) {
      try { fs.unlinkSync(state.tmpPath); } catch { }
    }

    const i10rPath = this.buildI10rPath(state.firmware, state.savePath);
    if (fs.existsSync(i10rPath)) {
      try { fs.unlinkSync(i10rPath); } catch { }
    }

    this.stateManager.delete(id);
    this.emit("incomplete_deleted", id);
    return { success: true };
  }

  getTask(id: string): Task | undefined { return this.tasks.get(id); }

  async getEnvironmentInfo(savePath: string): Promise<DiskEnvironmentInfo> {
    return this.diskManager.getEnvironmentInfo(savePath);
  }

  // ─── DOWNLOAD ORCHESTRATION ──────────────────────────────────────────────────

  private async runDownload(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    const gen = (this.runGenerations.get(id) ?? 0) + 1;
    this.runGenerations.set(id, gen);

    try {
      this.updateTaskStatus(id, "downloading");
      this.emit("started", id, task);

      // Step 1: HEAD metadata
      const meta = await ChunkManager.fetchMetadata(task.firmware.url);

      // Step 2: Determine download target
      const saveDriveCategory = await this.diskManager.getDriveCategoryForPath(task.savePath);
      const isSaveOnSSD = saveDriveCategory.startsWith("internal_ssd") || saveDriveCategory.startsWith("external_ssd");
      const fileName = this.extractFilename(task.firmware);

      let downloadPath: string;
      let tmpPath: string | null = null;

      if (isSaveOnSSD) {
        downloadPath = path.join(task.savePath, fileName + ".i10r");
        tmpPath = downloadPath;
      } else if (this.config.useTmp) {
        const ssdTmp = await this.diskManager.findTmpDir(task.firmware.filesize);
        if (ssdTmp) {
          const tmpDir = path.join(ssdTmp, "i10r-tmp");
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          downloadPath = path.join(tmpDir, `${id}.ipsw.tmp`);
          tmpPath = downloadPath;
        } else {
          downloadPath = path.join(task.savePath, fileName);
        }
      } else {
        downloadPath = path.join(task.savePath, fileName);
      }

      // Step 3: Build or load state
      const usingTmp = tmpPath !== null;
      let state = this.stateManager.load(id);
      if (!state) {
        state = this.buildState(id, task.firmware, task.savePath, tmpPath, fileName, meta);
        this.stateManager.save(state);
      }
      this.states.set(id, state);

      this.initCheckpoint(id);

      // Step 4: Connection parameters
      const effectiveIsSSD = usingTmp ? true : isSaveOnSSD;
      const maxConn = !effectiveIsSSD
        ? Math.min(8, this.config.maxTaskConnections)
        : this.config.maxTaskConnections;

      // Step 5: Create ChunkManager
      const cm = new ChunkManager(state, this.stateManager, {
        maxConnections: maxConn,
        initialConnections: this.config.taskInitConnections,
        chunkSize: this.perf.chunkSize,
        retryLimit: this.config.retryLimit,
        retryDelay: this.config.retryDelay,
        bandwidthLimitBps: this.config.bandwidthLimit,
        isHDD: !effectiveIsSSD,
        insecureTLS: this.config.insecureTLS,
        writeHighWater: this.perf.writeHighWater,
      });

      this.chunkManagers.set(id, cm);

      cm.on("progress", (p) => {
        const downloaded = p.bytesWritten;
        const total = p.totalBytes > 0 ? p.totalBytes : state.totalSize;
        task.progress = Math.min(99, (downloaded / total) * 100);
        task.speed = cm.getStableSpeed();
        task.eta = cm.getStableEta(total, downloaded);
        this.emitThrottledProgress(id, task);
      });

      cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));
      cm.on("chunkComplete", () => this.scheduleCheckpoint(id));

      // Step 6: Download
      await cm.start(downloadPath);

      if (task.status === "paused" || task.status === "cancelled") return;

      // Step 7: Post-download integrity verify (if enabled)
      if (this.config.integrityEnable) {
        const algo = this.config.integrityAlgorithm;
        const expected = this.getExpectedHash(task.firmware, algo);

        if (expected) {
          state.activeOperation = "verify";
          this.doCheckpoint(id);

          this.updateTaskStatus(id, "verifying");
          task.speed = 0;
          task.eta = undefined;
          this.emitProgressNow(id, task);

          const result = await this.integrity.verify(downloadPath, algo, expected, ({ pct, speed, eta }) => {
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
      }

      // Step 8: Hand off to transfer if tmp, or complete directly
      if (state.tmpPath !== null) {
        this.transferScheduler.enqueue({
          id,
          run: () => this.executeMove(id, task, state),
        });
      } else {
        task.speed = 0;
        task.eta = 0;
        task.progress = 100;
        this.updateTaskStatus(id, "completed");
        this.emitProgressNow(id, task);
        this.emit("completed", id, task);
        this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: true, deleteTask: false });
      }
    } catch (err: any) {
      if (this.runGenerations.get(id) !== gen) return;

      this.updateTaskStatus(id, "error");
      task.error = err.message;
      this.emit("error", id, err.message, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
    }
  }

  private async executeMove(id: string, task: Task, state: DownloadState): Promise<void> {
    const fileName = state.fileName || this.extractFilename(task.firmware);
    const finalPath = path.join(state.savePath, fileName);
    const i10rPath = this.buildI10rPath(task.firmware, task.savePath);
    const tmpPath = state.tmpPath!;

    state.activeOperation = "move";
    this.doCheckpoint(id);

    task.progress = 0;
    task.speed = 0;
    task.eta = undefined;
    this.emitProgressNow(id, task);

    const tmpDrive = this.diskManager.driveKey(tmpPath);
    const saveDrive = this.diskManager.driveKey(task.savePath);

    if (path.normalize(tmpPath) === path.normalize(i10rPath)) {
      try { fs.unlinkSync(finalPath); } catch { }
      fs.renameSync(tmpPath, finalPath);
      task.progress = 100;
    } else if (tmpDrive === saveDrive) {
      try { fs.unlinkSync(i10rPath); } catch { }
      fs.renameSync(tmpPath, i10rPath);
      try { fs.unlinkSync(finalPath); } catch { }
      fs.renameSync(i10rPath, finalPath);
      task.progress = 100;
    } else {
      await startMove(tmpPath, i10rPath, ({ pct, speed, eta }) => {
        task.progress = pct;
        task.speed = speed;
        task.eta = eta;
        this.emitThrottledProgress(id, task);
      });
      try { fs.unlinkSync(finalPath); } catch { }
      fs.renameSync(i10rPath, finalPath);
      task.progress = 100;
    }

    task.speed = 0;
    task.eta = 0;
    this.updateTaskStatus(id, "completed");
    this.emitProgressNow(id, task);
    this.emit("completed", id, task);
    this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: false });
  }

  // ─── State builders ──────────────────────────────────────────────────────────

  private computeAdaptiveChunkSize(fileSize: number): number {
    const gb = 1024 * 1024 * 1024;
    if (fileSize < 1 * gb) return 16 * 1024 * 1024;
    if (fileSize < 4 * gb) return 32 * 1024 * 1024;
    if (fileSize < 10 * gb) return 64 * 1024 * 1024;
    if (fileSize < 20 * gb) return 128 * 1024 * 1024;
    return 256 * 1024 * 1024;
  }

  private buildState(
    id: string,
    firmware: Firmware,
    savePath: string,
    tmpPath: string | null,
    fileName: string,
    meta: { contentLength: number; acceptsRanges: boolean },
  ): DownloadState {
    const totalSize = meta.contentLength || firmware.filesize;
    const supportsRanges = meta.acceptsRanges;

    if (totalSize <= 0) {
      return {
        id, firmware, savePath, tmpPath, fileName,
        totalSize: 0,
        chunks: [],
        supportsRanges,
        createdAt: Date.now(), updatedAt: Date.now(),
        activeOperation: "download",
        lastCheckpoint: Date.now(),
        lastWriteTime: 0,
      };
    }

    const baseChunkSize = this.computeAdaptiveChunkSize(totalSize);
    const effectiveChunkSize = this.perf.chunkSize > 0 ? this.perf.chunkSize : baseChunkSize;
    const chunks = buildFreshChunks(totalSize, supportsRanges, effectiveChunkSize);

    return {
      id, firmware, savePath, tmpPath, fileName,
      totalSize, chunks, supportsRanges,
      createdAt: Date.now(), updatedAt: Date.now(),
      activeOperation: "download",
      lastCheckpoint: Date.now(),
      lastWriteTime: 0,
    };
  }

  private buildI10rPath(firmware: Firmware, savePath: string): string {
    const filename = this.extractFilename(firmware);
    const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
      ? savePath
      : path.dirname(savePath);
    return path.join(dir, `${filename}.i10r`);
  }

  // ─── Hash helpers ───────────────────────────────────────────────────────────

  private getExpectedHash(firmware: Firmware, algo: "md5" | "sha1" | "sha256"): string | undefined {
    switch (algo) {
      case "md5": return firmware.md5sum;
      case "sha1": return firmware.sha1sum;
      case "sha256": return firmware.sha256sum;
    }
  }

  // ─── Checkpoint ──────────────────────────────────────────────────────────────

  private scheduleCheckpoint(id: string): void {
    const cs = this.checkpointState.get(id);
    if (!cs) return;
    cs.completedChunks++;

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

  // ─── Extract filename ───────────────────────────────────────────────────────

  private extractFilename(firmware: Firmware): string {
    try {
      const pathname = new URL(firmware.url).pathname;
      const name = pathname.split("/").pop();
      if (name) return name;
    } catch { }
    return `${firmware.identifier}_${firmware.buildid}.ipsw`;
  }

  // ─── Task helpers ───────────────────────────────────────────────────────────

  private updateTaskStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id);
    if (task) task.status = status;
  }

  private emitProgressNow(id: string, task: Task): void {
    const state = this.progressEmitState.get(id);
    if (state?.timer) clearTimeout(state.timer);
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
    },
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

    if (state) {
      const i10rPath = this.buildI10rPath(state.firmware, state.savePath);
      if (fs.existsSync(i10rPath)) {
        try { fs.unlinkSync(i10rPath); } catch { }
      }
    }

    if (options.deleteStateFile) {
      this.stateManager.delete(id);
    }

    this.states.delete(id);
    this.chunkManagers.delete(id);
    this.runGenerations.delete(id);
    this.clearCheckpoint(id);
    if (options.deleteTask) {
      this.tasks.delete(id);
    }
  }
}
