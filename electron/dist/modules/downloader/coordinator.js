"use strict";
/**
 * coordinator.ts
 *
 * DownloadCoordinator — central dispatcher that replaces IPSWDownloader as the
 * main orchestrator.  Owns the task list, scheduler, and turbo-state machine.
 *
 * Turbo rule:
 *   reloadTurboState() fires on every lifecycle event (started, completed, error,
 *   cancelled, paused, resumed).  It checks whether an active turbo task already
 *   exists.  If one does → stop.  Otherwise → promote one normal downloading task,
 *   or pull from the queue when no normal task is downloading.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadCoordinator = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const events_1 = require("events");
const crypto_1 = require("crypto");
const url_1 = require("url");
const disk_manager_1 = require("./disk-manager");
const state_manager_1 = require("./state-manager");
const chunk_manager_1 = require("./chunk-manager");
const scheduler_1 = require("./scheduler");
const integrity_1 = require("./integrity");
const GB = 1024 ** 3;
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
// ─── MoveQueue ────────────────────────────────────────────────────────────────
class MoveQueue {
    diskManager;
    queues = new Map();
    concurrency = new Map();
    hddLimit = 2;
    ssdLimit = 3;
    constructor(diskManager) {
        this.diskManager = diskManager;
    }
    async enqueue(src, dest, isHDD, priority = false, onProgress) {
        const key = this.driveKey(dest);
        const limit = isHDD ? this.hddLimit : this.ssdLimit;
        const prev = this.queues.get(key) ?? Promise.resolve();
        const task = prev.then(() => this.runWhenSlotOpen(key, limit, src, dest, onProgress));
        this.queues.set(key, task.catch(() => { }));
        return task;
    }
    async runWhenSlotOpen(key, limit, src, dest, onProgress) {
        while ((this.concurrency.get(key) ?? 0) >= limit) {
            await new Promise(r => setTimeout(r, 100));
        }
        this.concurrency.set(key, (this.concurrency.get(key) ?? 0) + 1);
        try {
            await this.doMove(src, dest, onProgress);
        }
        finally {
            this.concurrency.set(key, (this.concurrency.get(key) ?? 1) - 1);
        }
    }
    async doMove(src, dest, onProgress) {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir))
            fs.mkdirSync(destDir, { recursive: true });
        try {
            fs.renameSync(src, dest);
            if (onProgress)
                onProgress({ pct: 100, speed: 0, eta: 0 });
            return;
        }
        catch { /* cross-device */ }
        await this.copyViaKernel(src, dest, onProgress);
        fs.unlinkSync(src);
    }
    async copyViaKernel(src, dest, onProgress) {
        const totalSize = fs.statSync(src).size;
        const startedAt = Date.now();
        const bufferSize = this.getMoveBufferSize(totalSize, this.getAvailableMemoryBytes());
        const srcHandle = await fs.promises.open(src, "r");
        const destHandle = await fs.promises.open(dest, "w");
        try {
            const buffer = Buffer.allocUnsafe(bufferSize);
            let copied = 0, lastEmitAt = 0, lastPct = -1;
            while (true) {
                const { bytesRead } = await srcHandle.read(buffer, 0, buffer.length, copied);
                if (bytesRead <= 0)
                    break;
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
            if (onProgress)
                onProgress({ pct: 100, speed: totalSize, eta: 0 });
        }
        finally {
            await destHandle.close().catch(() => { });
            await srcHandle.close().catch(() => { });
        }
    }
    getMoveBufferSize(totalSize, availableMemoryBytes) {
        const mb = 1024 * 1024;
        const fileBased = totalSize <= 128 * mb ? 16 * mb :
            totalSize <= 512 * mb ? 32 * mb :
                totalSize <= 2 * GB ? 64 * mb :
                    totalSize <= 8 * GB ? 96 * mb : 128 * mb;
        const memoryBudget = Math.max(16 * mb, Math.floor(availableMemoryBytes * 0.02));
        return Math.max(mb, Math.floor(Math.max(8 * mb, Math.min(fileBased, memoryBudget)) / mb) * mb);
    }
    getAvailableMemoryBytes() {
        const free = typeof os.freemem === "function" ? os.freemem() : 0;
        const total = typeof os.totalmem === "function" ? os.totalmem() : 0;
        if (free > 0)
            return free;
        if (total > 0)
            return total * 0.25;
        return 256 * 1024 * 1024;
    }
    driveKey(filePath) {
        const resolved = path.resolve(filePath);
        if (process.platform === "win32")
            return path.parse(resolved).root.toUpperCase();
        const parts = resolved.split(path.sep).filter(Boolean);
        return path.sep + (parts[0] ?? "");
    }
}
// ─── DownloadCoordinator ──────────────────────────────────────────────────────
class DownloadCoordinator extends events_1.EventEmitter {
    config;
    tasks = new Map();
    states = new Map();
    chunkManagers = new Map();
    diskManager;
    stateManager;
    scheduler;
    integrity;
    moveQueue;
    progressEmitState = new Map();
    progressEmitIntervalMs = 150;
    progressEmitMinDelta = 1;
    moveProgressEmitIntervalMs = 200;
    environment = "ssd_save";
    envDetected = false;
    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(stateDir, config = {}) {
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
        this.diskManager = new disk_manager_1.DiskManager();
        this.moveQueue = new MoveQueue(this.diskManager);
        this.stateManager = new state_manager_1.StateManager(stateDir);
        this.scheduler = new scheduler_1.Scheduler(this.config.maxConcurrentTasks);
        this.integrity = new integrity_1.IntegrityChecker();
        this.scheduler.on("started", (id) => this.updateTaskStatus(id, "downloading"));
        // Every slot event triggers turbo rebalance
        this.scheduler.on("slot_open", () => this.reloadTurboState());
    }
    // ── Environment detection ────────────────────────────────────────────────
    async ensureEnvironment(savePath) {
        if (this.envDetected)
            return this.environment;
        const isSSD = await this.diskManager.detectSSD(savePath);
        if (isSSD) {
            this.environment = "ssd_save";
        }
        else {
            const tmpDir = await this.diskManager.chooseTmpDir(savePath, 1 * GB, this.config.tmpDir || undefined);
            const tmpIsSSD = await this.diskManager.detectSSD(tmpDir);
            this.environment = tmpIsSSD ? "hdd_ssd_tmp" : "hdd_only";
        }
        this.envDetected = true;
        if (this.config.turboMode) {
            this.scheduler.setTurboMode(true, this.environment);
        }
        return this.environment;
    }
    // ── Public API ───────────────────────────────────────────────────────────
    async add(firmware, savePath, reqConfig = {}) {
        if (!savePath || savePath.trim() === "")
            return { success: false, error: "INVALID_SAVE_PATH" };
        try {
            new url_1.URL(firmware.url);
        }
        catch {
            return { success: false, error: "INVALID_URL" };
        }
        for (const task of this.tasks.values()) {
            if (task.firmware.identifier === firmware.identifier &&
                task.firmware.buildid === firmware.buildid &&
                (task.status === "downloading" || task.status === "moving" ||
                    task.status === "verifying" || task.status === "queued" ||
                    task.status === "paused"))
                return { success: false, error: "ALREADY_IN_LIST" };
        }
        if (reqConfig.deleteFiles?.length) {
            for (const file of reqConfig.deleteFiles) {
                if (file?.path && fs.existsSync(file.path)) {
                    try {
                        fs.unlinkSync(file.path);
                    }
                    catch { }
                }
            }
        }
        const spaceCheck = await this.diskManager.hasEnoughSpace(savePath, firmware.filesize, this.config.diskBufferGB * GB);
        if (!spaceCheck.ok)
            return { success: false, error: "DISK_FULL" };
        await this.ensureEnvironment(savePath);
        const id = (0, crypto_1.randomUUID)();
        this.diskManager.reserveSpace(id, firmware.filesize);
        const task = {
            id, firmware, progress: 0, speed: 0,
            status: "queued", savePath, mode: "normal",
        };
        this.tasks.set(id, task);
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
            onSlotOpen: (slotType) => {
                const t = this.tasks.get(id);
                if (t) {
                    t.mode = slotType;
                    this.emit("progress", id, t);
                }
            },
        });
        this.emit("added", id, task);
        if (this.config.turboMode) {
            setImmediate(() => this.reloadTurboState());
        }
        return { success: true, id };
    }
    pause(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "downloading")
            return;
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.abort();
        this.scheduler.pauseTask(id);
        this.updateTaskStatus(id, "paused");
        this.emit("paused", id, task);
        if (this.config.turboMode) {
            setImmediate(() => this.reloadTurboState());
        }
    }
    resume(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "paused")
            return;
        task.mode = "normal"; // scheduler re-decides
        this.updateTaskStatus(id, "queued");
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
            onSlotOpen: (slotType) => {
                const t = this.tasks.get(id);
                if (t) {
                    t.mode = slotType;
                    this.emit("progress", id, t);
                }
            },
        });
        this.scheduler.resumeTask(id);
        this.emit("resumed", id, this.tasks.get(id));
        if (this.config.turboMode) {
            setImmediate(() => this.reloadTurboState());
        }
    }
    cancel(id) {
        const task = this.tasks.get(id);
        if (task)
            this.updateTaskStatus(id, "cancelled");
        const cm = this.chunkManagers.get(id);
        if (cm) {
            cm.cleanupTurboFile();
            cm.abort();
        }
        this.scheduler.cancelTask(id);
        this.cleanupRuntime(id, {
            releaseSpace: true, deleteTmpFile: true,
            deleteStateFile: true, deleteTask: true,
        });
        this.emit("cancelled", id);
        if (this.config.turboMode) {
            setImmediate(() => this.reloadTurboState());
        }
    }
    getAllTask() {
        for (const [id, cm] of this.chunkManagers.entries()) {
            const task = this.tasks.get(id);
            if (task && task.status === "downloading")
                task.speed = cm.getSpeed();
        }
        return Array.from(this.tasks.values());
    }
    getIncompleteTasks() {
        return this.stateManager.listAll()
            .filter(s => !this.tasks.has(s.id))
            .map(s => {
            const downloadedBytes = s.chunks.reduce((sum, c) => sum + c.downloaded, 0);
            const progress = s.totalSize > 0
                ? Math.floor((downloadedBytes / s.totalSize) * 100) : 0;
            return {
                id: s.id, firmware: s.firmware, savePath: s.savePath,
                tmpPath: s.tmpPath, totalSize: s.totalSize,
                downloadedBytes, progress,
                tmpExists: fs.existsSync(s.tmpPath), savedAt: s.updatedAt,
                mode: s.mode ?? "normal", movedChunks: s.movedChunks ?? [],
            };
        })
            .sort((a, b) => b.savedAt - a.savedAt);
    }
    resumeIncomplete(id) {
        if (this.tasks.has(id))
            return { success: false, error: "ALREADY_ACTIVE" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        const savedMode = state.mode ?? "normal";
        const movedChunks = state.movedChunks ?? [];
        // Crash recovery: reconcile .turbo on HDD+SSD
        if (savedMode === "turbo" && this.environment === "hdd_ssd_tmp") {
            const turboPath = this.buildTurboPath(state.firmware, state.savePath);
            if (fs.existsSync(turboPath)) {
                const turboStat = fs.statSync(turboPath);
                let turboOk = true;
                const completedChunks = state.chunks.filter(c => c.completed);
                if (completedChunks.length > 0) {
                    const lastCompleted = completedChunks[completedChunks.length - 1];
                    if (!movedChunks.includes(lastCompleted.index))
                        turboOk = false;
                }
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
                    try {
                        fs.unlinkSync(turboPath);
                    }
                    catch { }
                }
            }
            if (!fs.existsSync(turboPath) && state.tmpPath && fs.existsSync(state.tmpPath)) {
                const turboFd = fs.openSync(turboPath, "w");
                if (state.totalSize > 0)
                    fs.ftruncateSync(turboFd, state.totalSize);
                fs.closeSync(turboFd);
                for (const idx of movedChunks) {
                    const chunk = state.chunks[idx];
                    if (chunk && chunk.downloaded > 0) {
                        try {
                            const buf = Buffer.alloc(chunk.downloaded);
                            const fd = fs.openSync(state.tmpPath, "r");
                            fs.readSync(fd, buf, 0, chunk.downloaded, chunk.start);
                            fs.closeSync(fd);
                            fs.writeFileSync(turboPath, buf, { flag: "r+" });
                        }
                        catch { }
                    }
                }
            }
            if (!fs.existsSync(state.tmpPath) && !fs.existsSync(turboPath)) {
                for (const c of state.chunks) {
                    c.downloaded = 0;
                    c.completed = false;
                }
                state.movedChunks = [];
                state.mode = "normal";
                this.stateManager.save(state);
            }
        }
        const tmpExists = !!(state.tmpPath && fs.existsSync(state.tmpPath));
        if (!tmpExists) {
            for (const c of state.chunks) {
                c.downloaded = 0;
                c.completed = false;
            }
            state.movedChunks = [];
            this.stateManager.save(state);
        }
        const downloadedBytes = state.chunks.reduce((s, c) => s + c.downloaded, 0);
        const task = {
            id, firmware: state.firmware,
            progress: state.totalSize > 0
                ? Math.floor(downloadedBytes / state.totalSize * 100) : 0,
            speed: 0, status: "queued", savePath: state.savePath,
            mode: "normal",
        };
        this.tasks.set(id, task);
        this.states.set(id, state);
        this.diskManager.reserveSpace(id, state.firmware.filesize);
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
            onSlotOpen: (slotType) => {
                const t = this.tasks.get(id);
                if (t) {
                    t.mode = slotType;
                    this.emit("progress", id, t);
                }
            },
        });
        this.emit("added", id, task);
        if (this.config.turboMode) {
            setImmediate(() => this.reloadTurboState());
        }
        return { success: true };
    }
    deleteIncomplete(id) {
        if (this.tasks.has(id))
            return { success: false, error: "USE_CANCEL_FOR_ACTIVE_TASK" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        if (state.tmpPath && fs.existsSync(state.tmpPath)) {
            try {
                fs.unlinkSync(state.tmpPath);
            }
            catch { }
        }
        const turboPath = this.buildTurboPath(state.firmware, state.savePath);
        if (fs.existsSync(turboPath)) {
            try {
                fs.unlinkSync(turboPath);
            }
            catch { }
        }
        this.stateManager.delete(id);
        this.emit("incomplete_deleted", id);
        return { success: true };
    }
    getTask(id) { return this.tasks.get(id); }
    // ── Turbo state machine ──────────────────────────────────────────────────
    /**
     * Called on every lifecycle event.  Logic:
     *  1. If any active task already has mode "turbo" → stop (don't promote more)
     *  2. Otherwise → promote one "normal" + "downloading" task
     *  3. If no normal downloading task → pull from queue as turbo
     */
    reloadTurboState() {
        if (!this.config.turboMode)
            return;
        // 1. Already have a turbo task?
        for (const task of this.tasks.values()) {
            if (task.mode === "turbo" && this.scheduler.isActive(task.id)) {
                return; // stop — already have a turbo task running
            }
        }
        // 2. No turbo task — can we promote a normal downloading task?
        if (!this.scheduler.hasFreeTurboSlot())
            return;
        const normalIds = this.scheduler.getActiveNormalDownloadingIds();
        for (const id of normalIds) {
            const task = this.tasks.get(id);
            if (!task || task.status !== "downloading")
                continue;
            this.promoteTask(id).catch(err => {
                console.error(`[Coordinator] promoteTask(${id}) failed:`, err);
            });
            return; // promoted one
        }
        // 3. No normal downloading task — all normals are in "move"? Pull from queue.
        if (this.scheduler.areAllNormalSlotsFull()) {
            this.scheduler.tryFillTurboSlotFromQueue();
        }
    }
    async promoteTask(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        const cm = this.chunkManagers.get(id);
        if (!cm)
            return;
        const state = this.states.get(id) ?? this.stateManager.load(id);
        if (!state)
            return;
        const turboPath = this.buildTurboPath(task.firmware, task.savePath);
        const isHDD = !(await this.diskManager.detectSSD(task.savePath));
        const baseMaxConn = isHDD
            ? Math.min(8, this.config.maxConnectionsPerTask)
            : this.config.maxConnectionsPerTask;
        const turboMaxConn = Math.round(baseMaxConn * this.config.turboConnectionsMultiplier);
        // Atomically move slot normal → turbo
        const promoted = this.scheduler.promoteNormalToTurbo(id);
        if (!promoted)
            return;
        // Pause → flush downloaded chunks to .turbo → switch → resume
        // (fd stays on SSD tmp — download never touches HDD)
        await cm.promote(state.tmpPath, turboPath);
        cm.updateMaxConnections(turboMaxConn);
        task.mode = "turbo";
        state.mode = "turbo";
        this.stateManager.save(state);
        this.emit("progress", id, task);
        this.emit("promoted", id, task);
        // Fill the freed normal slot
        this.scheduler.drain();
    }
    // ── Download execution ───────────────────────────────────────────────────
    async runDownload(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        try {
            this.updateTaskStatus(id, "downloading");
            this.emit("started", id, task);
            const meta = await chunk_manager_1.ChunkManager.fetchMetadata(task.firmware.url);
            const isHDD = !(await this.diskManager.detectSSD(task.savePath));
            const tmpDir = await this.diskManager.chooseTmpDir(task.savePath, task.firmware.filesize, this.config.tmpDir || undefined);
            const tmpFile = path.join(tmpDir, `${id}.ipsw.tmp`);
            let state = this.stateManager.load(id);
            if (!state) {
                state = this.buildState(id, task.firmware, task.savePath, tmpFile, meta, task.mode);
                this.stateManager.save(state);
            }
            this.states.set(id, state);
            const baseMaxConn = isHDD
                ? Math.min(8, this.config.maxConnectionsPerTask)
                : this.config.maxConnectionsPerTask;
            const maxConn = task.mode === "turbo"
                ? Math.round(baseMaxConn * this.config.turboConnectionsMultiplier)
                : baseMaxConn;
            const chunkSize = task.mode === "turbo"
                ? Math.round(this.config.chunkSize * this.config.turboChunkSizeMultiplier)
                : this.config.chunkSize;
            // Turbo HDD+SSD: set up progressive tmp → .turbo streaming
            let turboHddSsd;
            if (this.config.turboMode && isHDD && this.environment === "hdd_ssd_tmp" && task.mode === "turbo") {
                const turboPath = this.buildTurboPath(task.firmware, task.savePath);
                turboHddSsd = {
                    turboPath,
                    onTurboMove: () => { },
                    onTurboHddError: (err) => {
                        console.error(`[Coordinator] Turbo HDD error for ${id}:`, err.message);
                    },
                };
            }
            const cm = new chunk_manager_1.ChunkManager(state, this.stateManager, {
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
            // If task started as normal + turbo slot free → promote immediately
            if (this.config.turboMode && task.mode === "normal" && this.scheduler.hasFreeTurboSlot()) {
                setImmediate(() => {
                    this.promoteTask(id).catch(err => console.error(`[Coordinator] Initial promoteTask(${id}) failed:`, err));
                });
            }
            cm.on("turboHddError", async () => { await cm.stopIOWorker(); });
            cm.on("turboMove", (info) => {
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
                const total = p.totalBytes > 0 ? p.totalBytes : state.totalSize;
                task.progress = Math.min(99, Math.floor((downloaded / total) * 100));
                task.speed = cm.getSpeed();
                task.eta = task.speed > 0 ? Math.round((total - downloaded) / task.speed) : undefined;
                this.emitThrottledProgress(id, task);
            });
            cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));
            // ── Download ──────────────────────────────────────────────────────
            await cm.start(tmpFile);
            if (task.status === "paused" || task.status === "cancelled")
                return;
            // ── Verify tmp on SSD (fast) ──────────────────────────────────────
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
                this.cleanupRuntime(id, {
                    releaseSpace: true, deleteTmpFile: true,
                    deleteStateFile: true, deleteTask: true,
                });
                this.reloadTurboState();
                return;
            }
            // ── Finalize ──────────────────────────────────────────────────────
            const finalPath = this.buildFinalPath(task.firmware, task.savePath);
            if (cm.isTurboHddSsd()) {
                // Turbo HDD+SSD: chunks were progressively streamed tmp → .turbo
                // Drain IOWriteQueue, confirm movedChunks coverage, rename .turbo → final
                this.updateTaskStatus(id, "moving");
                task.progress = 0;
                task.speed = 0;
                task.eta = undefined;
                this.emitProgressNow(id, task);
                await cm.drainIOWorker();
                const totalMoved = cm.getTotalMovedBytes();
                task.progress = state.totalSize > 0
                    ? Math.floor((totalMoved / state.totalSize) * 100) : 100;
                this.emitThrottledProgress(id, task);
                const turboPath = cm.getTurboPath();
                const stateReloaded = this.stateManager.load(id);
                const completedIndices = (stateReloaded?.chunks ?? [])
                    .filter(c => c.completed).map(c => c.index);
                const movedSet = new Set(stateReloaded?.movedChunks ?? []);
                const allMoved = completedIndices.every(i => movedSet.has(i));
                if (allMoved) {
                    try {
                        fs.unlinkSync(finalPath);
                    }
                    catch { }
                    fs.renameSync(turboPath, finalPath);
                }
                else {
                    console.warn(`[Coordinator] Turbo move incomplete ` +
                        `(${movedSet.size}/${completedIndices.length}), fallback`);
                    await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, true, ({ pct, speed, eta }) => {
                        task.progress = pct;
                        task.speed = speed;
                        task.eta = eta;
                        this.emitThrottledProgress(id, task);
                    });
                }
            }
            else {
                // Normal / SSD saveDir / HDD-only: MoveQueue
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
            // ── Done — clear mode, notify, rebalance ──────────────────────────
            task.progress = 100;
            task.speed = 0;
            task.eta = 0;
            task.mode = "normal";
            this.updateTaskStatus(id, "completed");
            this.emitProgressNow(id, task);
            this.emit("completed", id, task);
            this.cleanupRuntime(id, {
                releaseSpace: true, deleteTmpFile: true,
                deleteStateFile: true, deleteTask: false,
            });
            this.reloadTurboState();
        }
        catch (err) {
            if (task.status === "cancelled")
                return;
            if (task.status === "paused")
                return;
            this.updateTaskStatus(id, "error");
            task.error = err.message;
            this.emit("error", id, err.message, task);
            this.cleanupRuntime(id, {
                releaseSpace: true, deleteTmpFile: false,
                deleteStateFile: false, deleteTask: true,
            });
            this.reloadTurboState();
        }
    }
    // ── Helpers ──────────────────────────────────────────────────────────────
    buildState(id, firmware, savePath, tmpPath, meta, mode = "normal") {
        const totalSize = meta.contentLength || firmware.filesize;
        const supportsRanges = meta.acceptsRanges;
        const chunks = [];
        if (supportsRanges && totalSize > 0) {
            let offset = 0, index = 0;
            while (offset < totalSize) {
                const end = Math.min(offset + this.config.chunkSize - 1, totalSize - 1);
                chunks.push({ index, start: offset, end, downloaded: 0, completed: false });
                offset = end + 1;
                index++;
            }
        }
        else {
            chunks.push({ index: 0, start: 0, end: totalSize - 1, downloaded: 0, completed: false });
        }
        return {
            id, firmware, savePath, tmpPath, totalSize, chunks, supportsRanges,
            createdAt: Date.now(), updatedAt: Date.now(), mode, movedChunks: [],
        };
    }
    buildFinalPath(firmware, savePath) {
        const filename = firmware.url.split("/").pop()
            || `${firmware.identifier}_${firmware.buildid}.ipsw`;
        if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
            return path.join(savePath, filename);
        }
        return savePath;
    }
    buildTurboPath(firmware, savePath) {
        const filename = firmware.url.split("/").pop()
            || `${firmware.identifier}_${firmware.buildid}.ipsw`;
        const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
            ? savePath : path.dirname(savePath);
        return path.join(dir, `${filename}.turbo`);
    }
    updateTaskStatus(id, status) {
        const task = this.tasks.get(id);
        if (task)
            task.status = status;
    }
    // ── Progress emit ────────────────────────────────────────────────────────
    emitProgressNow(id, task) {
        const st = this.progressEmitState.get(id);
        if (st?.timer)
            clearTimeout(st.timer);
        this.progressEmitState.delete(id);
        this.emit("progress", id, task);
    }
    emitThrottledProgress(id, task) {
        const now = Date.now();
        const prev = this.progressEmitState.get(id);
        const progressChanged = !prev ||
            Math.abs(task.progress - prev.lastProgress) >= this.progressEmitMinDelta;
        const shouldFlushNow = !prev || progressChanged ||
            (now - prev.lastAt) >= this.progressEmitIntervalMs;
        if (shouldFlushNow) {
            if (prev?.timer)
                clearTimeout(prev.timer);
            this.progressEmitState.set(id, {
                lastAt: now, lastProgress: task.progress, timer: null, pending: null,
            });
            this.emit("progress", id, task);
            return;
        }
        if (!prev)
            return;
        prev.pending = { ...task };
        if (!prev.timer) {
            const delay = Math.max(0, this.progressEmitIntervalMs - (now - prev.lastAt));
            prev.timer = setTimeout(() => {
                const cur = this.progressEmitState.get(id);
                if (!cur)
                    return;
                const pending = cur.pending;
                this.progressEmitState.delete(id);
                if (pending)
                    this.emit("progress", id, pending);
            }, delay);
        }
    }
    // ── Cleanup ──────────────────────────────────────────────────────────────
    cleanupRuntime(id, opts) {
        const ps = this.progressEmitState.get(id);
        if (ps?.timer)
            clearTimeout(ps.timer);
        this.progressEmitState.delete(id);
        if (opts.releaseSpace)
            this.diskManager.releaseSpace(id);
        const state = this.states.get(id) ?? this.stateManager.load(id);
        if (opts.deleteTmpFile && state?.tmpPath && fs.existsSync(state.tmpPath)) {
            try {
                fs.unlinkSync(state.tmpPath);
            }
            catch { }
        }
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.cleanupTurboFile();
        if (opts.deleteStateFile)
            this.stateManager.delete(id);
        this.states.delete(id);
        this.chunkManagers.delete(id);
        if (opts.deleteTask)
            this.tasks.delete(id);
    }
}
exports.DownloadCoordinator = DownloadCoordinator;
