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

const GB = 1024 ** 3;
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB

// ─── MoveQueue ────────────────────────────────────────────────────────────────

class MoveQueue {
  private queues = new Map<string, Promise<void>>();
  private concurrency = new Map<string, number>();
  private readonly hddLimit = 2;
  private readonly ssdLimit = 3;

  constructor(private diskManager: DiskManager) { }

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
      this.concurrency.set(key, (this.concurrency.get(key) ?? 1) - 1);
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

    const srcHandle = await fs.promises.open(src, "r");
    const destHandle = await fs.promises.open(dest, "w");

    try {
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
          const speed = copied / elapsedSec;
          const eta = speed > 0 ? Math.max(0, Math.round((totalSize - copied) / speed)) : undefined;

          if (pct !== lastPct || now - lastEmitAt >= 200 || copied === totalSize) {
            lastEmitAt = now;
            lastPct = pct;
            onProgress({ pct, speed, eta });
          }
        }
      }

      await destHandle.sync().catch(() => { });
      if (onProgress) onProgress({ pct: 100, speed: totalSize, eta: 0 });
    } finally {
      await destHandle.close().catch(() => { });
      await srcHandle.close().catch(() => { });
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

  private environment: DownloadEnvironment = "ssd_save";
  private envDetected = false;

  constructor(stateDir: string, config: DownloaderConfig = {}) {
    super();
    this.config = {
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
      turboConnectionsMultiplier: config.turboConnectionsMultiplier ?? 2.0,
      turboChunkSizeMultiplier: config.turboChunkSizeMultiplier ?? 2.0,
    };

    this.diskManager = new DiskManager();
    this.moveQueue = new MoveQueue(this.diskManager);
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

    // Configure scheduler limits based on environment
    if (this.config.turboMode) {
      this.scheduler.setTurboMode(true, this.environment);
    }

    console.log(`[INFO] Environment: ${this.environment}`);

    return this.environment;
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  async add(firmware: Firmware, savePath: string, config: DownloadRequestConfig = {}): Promise<AddResult> {
    if (!savePath || savePath.trim() === "") return { success: false, error: "INVALID_SAVE_PATH" };
    try { new URL(firmware.url); } catch { return { success: false, error: "INVALID_URL" }; }

    for (const task of this.tasks.values()) {
      if (
        task.firmware.identifier === firmware.identifier &&
        task.firmware.buildid === firmware.buildid &&
        (task.status === 'downloading' || task.status === 'moving' || task.status === 'verifying' || task.status === 'queued' || task.status === 'paused')
      ) return { success: false, error: "ALREADY_IN_LIST" };
    }

    if (config.deleteFiles?.length) {
      for (const file of config.deleteFiles) {
        if (file?.path && fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch { }
        }
      }
    }

    const spaceCheck = await this.diskManager.hasEnoughSpace(
      savePath, firmware.filesize, this.config.diskBufferGB * GB
    );
    if (!spaceCheck.ok) return { success: false, error: "DISK_FULL" };

    // Detect environment on first add
    await this.ensureEnvironment(savePath);

    const id = randomUUID();
    this.diskManager.reserveSpace(id, firmware.filesize);

    // All tasks start as "normal" — scheduler assigns turbo when draining
    const task: Task = { id, firmware, progress: 0, speed: 0, status: "queued", savePath, mode: "normal" };
    this.tasks.set(id, task);

    this.scheduler.enqueue({
      id,
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

    // After scheduling, try to fill turbo slots (promotion or queue→turbo)
    if (this.config.turboMode) {
      setImmediate(() => this.refreshSlots());
    }

    return { success: true, id };
  }

  pause(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== "downloading") return;

    const cm = this.chunkManagers.get(id);
    if (cm) cm.abort();

    this.scheduler.pauseTask(id);
    this.updateTaskStatus(id, "paused");
    this.emit("paused", id, task);
  }

  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== "paused") return;

    // Reset mode to "normal" — scheduler re-decides slot assignment.
    // This prevents turbo-slot overflow when a paused turbo task resumes.
    task.mode = "normal";

    this.updateTaskStatus(id, "queued");
    this.scheduler.enqueue({
      id,
      run: () => this.runDownload(id),
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

    // Trigger promotion attempt after resume — if slots are short, fill them
    if (this.config.turboMode) {
      setImmediate(() => this.refreshSlots());
    }
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);

    if (task) this.updateTaskStatus(id, "cancelled" as TaskStatus);

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
  }

  getAllTask(): Task[] {
    for (const [id, cm] of this.chunkManagers.entries()) {
      const task = this.tasks.get(id);
      if (task && task.status === "downloading") task.speed = cm.getSpeed();
    }
    return Array.from(this.tasks.values());
  }

  getIncompleteTasks(): IncompleteTask[] {
    return this.stateManager.listAll()
      .filter(s => !this.tasks.has(s.id))
      .map(s => {
        const downloadedBytes = s.chunks.reduce((sum, c) => sum + c.downloaded, 0);
        const progress = s.totalSize > 0 ? Math.floor((downloadedBytes / s.totalSize) * 100) : 0;
        return {
          id: s.id,
          firmware: s.firmware,
          savePath: s.savePath,
          tmpPath: s.tmpPath,
          totalSize: s.totalSize,
          downloadedBytes,
          progress,
          tmpExists: fs.existsSync(s.tmpPath),
          savedAt: s.updatedAt,
          mode: s.mode ?? "normal",
          movedChunks: s.movedChunks ?? [],
        } satisfies IncompleteTask;
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  resumeIncomplete(id: string): { success: boolean; error?: string } {
    if (this.tasks.has(id)) return { success: false, error: "ALREADY_ACTIVE" };

    const state = this.stateManager.load(id);
    if (!state) return { success: false, error: "STATE_NOT_FOUND" };

    const mode: DownloadMode = state.mode ?? "normal";
    const movedChunks = state.movedChunks ?? [];

    // ── Crash recovery: reconcile .turbo file if this was a turbo task on HDD+SSD ──
    if (mode === "turbo" && this.environment === "hdd_ssd_tmp") {
      const turboPath = this.buildTurboPath(state.firmware, state.savePath);

      if (fs.existsSync(turboPath)) {
        // Verify consistency between .turbo and state.movedChunks
        const turboStat = fs.statSync(turboPath);
        let turboOk = true;

        // Last-chunk validation: check if last completed chunk is in movedChunks
        const completedChunks = state.chunks.filter(c => c.completed);
        if (completedChunks.length > 0) {
          const lastCompleted = completedChunks[completedChunks.length - 1];
          if (!movedChunks.includes(lastCompleted.index)) {
            // Downloaded to tmp but never moved to HDD — needs re-queue
            turboOk = false;
          }
        }

        // Size check for moved chunks
        if (turboOk) {
          for (const idx of movedChunks) {
            const chunk = state.chunks[idx];
            if (chunk && turboStat.size < chunk.end + 1) {
              turboOk = false;
              break;
            }
          }
        }

        if (!turboOk) {
          // Stale .turbo — delete and recreate from tmp
          try { fs.unlinkSync(turboPath); } catch { }
        }
      }

      // If .turbo doesn't exist but SSD tmp does, re-create from movedChunks
      if (!fs.existsSync(turboPath) && state.tmpPath && fs.existsSync(state.tmpPath)) {
        const turboFd = fs.openSync(turboPath, "w");
        if (state.totalSize > 0) {
          fs.ftruncateSync(turboFd, state.totalSize);
        }
        fs.closeSync(turboFd);

        // Stream moved chunks from tmp to .turbo
        for (const idx of movedChunks) {
          const chunk = state.chunks[idx];
          if (chunk && chunk.downloaded > 0) {
            try {
              const buf = Buffer.alloc(chunk.downloaded);
              const fd = fs.openSync(state.tmpPath, "r");
              fs.readSync(fd, buf, 0, chunk.downloaded, chunk.start);
              fs.closeSync(fd);
              fs.writeFileSync(turboPath, buf, { flag: "r+" });
            } catch { }
          }
        }
      }

      // If neither .turbo nor tmp exist, reset and fall back to hdd_only
      if (!fs.existsSync(state.tmpPath) && !fs.existsSync(turboPath)) {
        for (const chunk of state.chunks) {
          chunk.downloaded = 0;
          chunk.completed = false;
        }
        state.movedChunks = [];
        state.mode = "normal";
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

    const downloadedBytes = state.chunks.reduce((s, c) => s + c.downloaded, 0);

    const task: Task = {
      id,
      firmware: state.firmware,
      progress: state.totalSize > 0
        ? Math.floor(downloadedBytes / state.totalSize * 100)
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

    // Trigger promotion attempt so incomplete tasks can get turbo
    if (this.config.turboMode) {
      setImmediate(() => this.refreshSlots());
    }

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

    const normalIds = this.scheduler.getActiveNormalDownloadingIds();
    for (const id of normalIds) {
      const task = this.tasks.get(id);
      if (!task) continue;
      if (task.status !== "downloading") continue;

      this.promoteTask(id).catch(err => {
        console.error(`[IPSWDownloader] promoteTask(${id}) failed:`, err);
      });
      return; // promoteTask is async; cascade via refreshSlots in promoteTask's drain
    }

    // No normal downloading task available for promotion.
    // If all normal slots are full (tasks in "move"), pull from queue as turbo.
    if (this.scheduler.areAllNormalSlotsFull()) {
      this.scheduler.tryFillTurboSlotFromQueue();
    }
  }

  private async promoteTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

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

      cm.on("turboMove", (info) => {
        // During move phase, use movedBytes for progress
        if (task.status === "moving") {
          task.progress = info.totalSize > 0
            ? Math.min(99, Math.floor((info.totalMovedBytes / info.totalSize) * 100))
            : task.progress;
          task.speed = 0;
          task.eta = undefined;
          this.emitThrottledProgress(id, task);
        }
      });

      cm.on("progress", (p) => {
        const downloaded = p.bytesWritten;
        const total = p.totalBytes > 0 ? p.totalBytes : state!.totalSize;
        task.progress = Math.min(99, Math.floor((downloaded / total) * 100));
        task.speed = cm.getSpeed();
        task.eta = task.speed > 0 ? Math.round((total - downloaded) / task.speed) : undefined;
        this.emitThrottledProgress(id, task);
      });

      cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));

      // Step 7: Download
      await cm.start(tmpFile);

      if (task.status === "paused" || task.status === "cancelled") return;

      // Step 8: Verify integrity
      this.updateTaskStatus(id, "verifying");
      task.speed = 0;
      task.eta = undefined;
      this.emitProgressNow(id, task);

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

      // Step 9: Move tmp → final (or finish progressive turbo move)
      const finalPath = this.buildFinalPath(task.firmware, task.savePath);

      if (cm.isTurboHddSsd()) {
        // Turbo HDD+SSD: chunks were progressively moved to .turbo during download.
        // Drain the IOWriteQueue so every completed chunk is on .turbo.
        this.updateTaskStatus(id, "moving");
        task.progress = 0;
        task.speed = 0;
        task.eta = undefined;
        this.emitProgressNow(id, task);

        // Drain — wait for ALL queued chunks to finish moving (not just abort)
        await cm.drainIOWorker();

        const totalMoved = cm.getTotalMovedBytes();
        task.progress = state.totalSize > 0
          ? Math.floor((totalMoved / state.totalSize) * 100)
          : 100;
        this.emitThrottledProgress(id, task);

        const turboPath = cm.getTurboPath()!;

        // Verify every completed chunk is in movedChunks (NOT file size —
        // the .turbo is pre-allocated so stat would say "full" even with holes).
        const stateReloaded = this.stateManager.load(id);
        const completedIndices = (stateReloaded?.chunks ?? [])
          .filter(c => c.completed)
          .map(c => c.index);
        const movedSet = new Set(stateReloaded?.movedChunks ?? []);
        const allMoved = completedIndices.every(i => movedSet.has(i));

        if (allMoved) {
          try { fs.unlinkSync(finalPath); } catch { }
          fs.renameSync(turboPath, finalPath);
        } else {
          // Fallback: use MoveQueue for any chunks that weren't moved
          this.emit("log", id, `Turbo move incomplete (${movedSet.size}/${completedIndices.length} chunks), falling back to MoveQueue`);
          await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, true, ({ pct, speed, eta }) => {
            task.progress = pct;
            task.speed = speed;
            task.eta = eta;
            this.emitThrottledProgress(id, task);
          });
        }
      } else {
        // Normal path (or turbo on SSD / HDD-only): MoveQueue
        this.updateTaskStatus(id, "moving");
        task.progress = 0;
        task.speed = 0;
        task.eta = undefined;
        this.emitProgressNow(id, task);

        const isTurbo = task.mode === "turbo";
        await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, isTurbo, ({ pct, speed, eta }) => {
          task.progress = pct;
          task.speed = speed;
          task.eta = eta;
          this.emitThrottledProgress(id, task);
        });
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
      if (task.status === "cancelled") return;
      if (task.status === "paused") return;

      this.updateTaskStatus(id, "error");
      task.error = err.message;
      this.emit("error", id, err.message, task);
      this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

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
    const chunks: ChunkState[] = [];

    if (supportsRanges && totalSize > 0) {
      let offset = 0, index = 0;
      while (offset < totalSize) {
        const end = Math.min(offset + this.config.chunkSize - 1, totalSize - 1);
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
    };
  }

  private buildFinalPath(firmware: Firmware, savePath: string): string {
    const filename = firmware.url.split("/").pop() || `${firmware.identifier}_${firmware.buildid}.ipsw`;
    if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
      return path.join(savePath, filename);
    }
    return savePath;
  }

  private buildTurboPath(firmware: Firmware, savePath: string): string {
    const filename = firmware.url.split("/").pop() || `${firmware.identifier}_${firmware.buildid}.ipsw`;
    const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
      ? savePath
      : path.dirname(savePath);
    return path.join(dir, `${filename}.turbo`);
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

    // Clean up .turbo file if it exists
    const cm = this.chunkManagers.get(id);
    if (cm) cm.cleanupTurboFile();

    if (options.deleteStateFile) {
      this.stateManager.delete(id);
    }

    this.states.delete(id);
    this.chunkManagers.delete(id);
    if (options.deleteTask) {
      this.tasks.delete(id);
    }
  }
}
