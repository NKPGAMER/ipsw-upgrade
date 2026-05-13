"use strict";
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
exports.IPSWDownloader = void 0;
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
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB
// ─── MoveQueue ────────────────────────────────────────────────────────────────
class MoveQueue {
    queues = new Map();
    concurrency = new Map();
    hddLimit = 2;
    ssdLimit = 3;
    setHddLimit(n) { this.hddLimit = n; }
    async enqueue(src, dest, isHDD, priority = false, onProgress) {
        const key = this.driveKey(dest);
        const limit = isHDD ? this.hddLimit : this.ssdLimit;
        const prev = this.queues.get(key) ?? Promise.resolve();
        const task = prev.then(() => this.runWhenSlotOpen(key, limit, src, dest, onProgress));
        if (priority) {
            // Turbo moves get priority — swap the pending task
            this.queues.set(key, task.catch(() => { }));
        }
        else {
            this.queues.set(key, task.catch(() => { }));
        }
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
        catch { /* cross-device — fall through */ }
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
            let copied = 0;
            let lastEmitAt = 0;
            let lastPct = -1;
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
                    totalSize <= 8 * GB ? 96 * mb :
                        128 * mb;
        const memoryBudget = Math.max(16 * mb, Math.floor(availableMemoryBytes * 0.02));
        const memoryAware = Math.max(8 * mb, Math.min(fileBased, memoryBudget));
        return this.alignBufferSize(memoryAware);
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
    alignBufferSize(size) {
        const mb = 1024 * 1024;
        return Math.max(mb, Math.floor(size / mb) * mb);
    }
    driveKey(filePath) {
        const resolved = path.resolve(filePath);
        if (process.platform === "win32")
            return path.parse(resolved).root.toUpperCase();
        const parts = resolved.split(path.sep).filter(Boolean);
        return path.sep + (parts[0] ?? "");
    }
}
// ─── IPSWDownloader ───────────────────────────────────────────────────────────
class IPSWDownloader extends events_1.EventEmitter {
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
    // Guards against stale runDownload() catch blocks emitting spurious errors
    // after pause/cancel/resume. Incremented on each lifecycle change.
    runGenerations = new Map();
    environment = "ssd_save";
    envDetected = false;
    constructor(stateDir, config) {
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
        };
        this.diskManager = new disk_manager_1.DiskManager();
        this.moveQueue = new MoveQueue();
        this.stateManager = new state_manager_1.StateManager(stateDir);
        this.scheduler = new scheduler_1.Scheduler(this.config.maxConcurrentTasks);
        this.integrity = new integrity_1.IntegrityChecker();
        this.scheduler.on("started", (id) => this.updateTaskStatus(id, "downloading"));
        // Handle any slot opening — try to fill turbo from normal, then normal from queue
        this.scheduler.on("slot_open", (_id, _slotType) => {
            if (this.config.turboMode) {
                this.refreshSlots();
            }
        });
    }
    // ─── Environment detection ─────────────────────────────────────────────────
    async ensureEnvironment(savePath) {
        if (this.envDetected)
            return this.environment;
        const isSSD = await this.diskManager.detectSSD(savePath);
        if (isSSD) {
            this.environment = "ssd_save";
        }
        else {
            // HDD — check if SSD tmp is available (chooseTmpDir returns null when only HDDs qualify)
            const tmpDir = await this.diskManager.chooseTmpDir(savePath, 1 * GB, 1 * GB, this.config.tmpDir || undefined);
            if (tmpDir !== null) {
                this.environment = "hdd_ssd_tmp";
            }
            else {
                this.environment = "hdd_only";
            }
        }
        this.envDetected = true;
        this.scheduler.setTurboMode(this.config.turboMode, this.environment);
        // On pure HDD, throttle move concurrency to avoid saturating IO
        if (this.environment === "hdd_only") {
            this.moveQueue.setHddLimit(1);
        }
        console.log(`[INFO] Environment: ${this.environment}`);
        return this.environment;
    }
    // ─── PUBLIC API ──────────────────────────────────────────────────────────────
    async add(firmware, config = {}) {
        const saveDir = this.config.saveDir;
        if (!saveDir || !fs.existsSync(saveDir))
            return { success: false, error: "INVALID_SAVE_PATH" };
        try {
            new url_1.URL(firmware.url);
        }
        catch {
            return { success: false, error: "INVALID_URL" };
        }
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
                            try {
                                fs.unlinkSync(file.path);
                            }
                            catch { }
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
                        }
                        else if (!lastCompleted && turboStat.size >= existingState.totalSize) {
                            wasTurbo = true;
                        }
                        else {
                            try {
                                fs.unlinkSync(turboPath);
                            }
                            catch { }
                            existingState.mode = "normal";
                            existingState.movedChunks = [];
                            this.stateManager.save(existingState);
                        }
                    }
                    else {
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
                }
                await this.ensureEnvironment(existingState.savePath);
                // If resuming a turbo task and all turbo slots are full, preempt
                if (wasTurbo && !this.scheduler.hasFreeTurboSlot()) {
                    this.preemptForTurboSlot();
                }
                this.diskManager.reserveSpace(config.taskId, existingState.firmware.filesize);
                const downloadedBytes = existingState.chunks.reduce((s, c) => s + c.downloaded, 0);
                const resumeTask = {
                    id: config.taskId,
                    firmware: existingState.firmware,
                    progress: existingState.totalSize > 0
                        ? Math.floor(downloadedBytes / existingState.totalSize * 100)
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
                    run: () => this.runDownload(config.taskId),
                    onSlotOpen: (slotType) => {
                        const t = this.tasks.get(config.taskId);
                        if (t) {
                            t.mode = slotType;
                            this.emit("progress", config.taskId, t);
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
            if (task.firmware.identifier === firmware.identifier &&
                task.firmware.buildid === firmware.buildid &&
                (task.status === 'downloading' || task.status === 'moving' || task.status === 'verifying' || task.status === 'queued' || task.status === 'paused'))
                return { success: false, error: "ALREADY_IN_LIST" };
        }
        const spaceCheck = await this.diskManager.hasEnoughSpace(saveDir, firmware.filesize, this.config.diskBufferGB * GB, config.deleteFiles ?? []);
        if (!spaceCheck.ok)
            return { success: false, error: "DISK_FULL" };
        if (config.deleteFiles?.length) {
            for (const file of config.deleteFiles) {
                if (file?.path && fs.existsSync(file.path)) {
                    try {
                        fs.unlinkSync(file.path);
                    }
                    catch { }
                }
            }
        }
        // Detect environment on first add
        await this.ensureEnvironment(saveDir);
        const id = (0, crypto_1.randomUUID)();
        this.diskManager.reserveSpace(id, firmware.filesize);
        // All tasks start as "normal" — scheduler assigns turbo when draining
        const task = { id, firmware, progress: 0, speed: 0, status: "queued", savePath: saveDir, mode: "normal" };
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
        return { success: true, id };
    }
    pause(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "downloading")
            return;
        // Bump generation so the old runDownload catch block is silenced
        this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.abort();
        this.scheduler.pauseTask(id);
        this.updateTaskStatus(id, "paused");
        this.emit("paused", id, task);
    }
    resume(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "paused")
            return;
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
            setImmediate(() => this.refreshSlots());
        }
    }
    /**
     * Make room for a turbo task. If a normal slot is already free, simply
     * demote one turbo task to normal. Otherwise preempt the downloading task
     * with the lowest progress and demote a turbo task to the freed slot.
     */
    preemptForTurboSlot() {
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
        let victimId = null;
        let lowestProgress = 100;
        for (const nid of allIds) {
            const nt = this.tasks.get(nid);
            if (nt && nt.status === "downloading" && nt.progress < lowestProgress) {
                lowestProgress = nt.progress;
                victimId = nid;
            }
        }
        if (!victimId)
            return;
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
    demoteTurboTask(demoteId) {
        if (!this.scheduler.demoteTurboToNormal(demoteId))
            return;
        const demotedTask = this.tasks.get(demoteId);
        if (!demotedTask)
            return;
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
    cancel(id) {
        const task = this.tasks.get(id);
        // Bump generation so the old runDownload catch block is silenced
        this.runGenerations.set(id, (this.runGenerations.get(id) ?? 0) + 1);
        if (task)
            this.updateTaskStatus(id, "cancelled");
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
                }
                else if (!lastCompleted && turboStat.size >= state.totalSize) {
                    wasTurbo = true;
                }
                else {
                    try {
                        fs.unlinkSync(turboPath);
                    }
                    catch { }
                    state.mode = "normal";
                    state.movedChunks = [];
                    this.stateManager.save(state);
                }
            }
            else {
                state.mode = "normal";
                state.movedChunks = [];
                this.stateManager.save(state);
            }
        }
        // Check tmp still exists
        const tmpExists = !!(state.tmpPath && fs.existsSync(state.tmpPath));
        if (!tmpExists) {
            console.log(`[IPSWDownloader] resumeIncomplete(${id}): tmp file not found at "${state.tmpPath}", ` +
                `resetting ${state.chunks.length} chunks for a fresh download.`);
            for (const chunk of state.chunks) {
                chunk.downloaded = 0;
                chunk.completed = false;
            }
            state.movedChunks = [];
            this.stateManager.save(state);
        }
        // If resuming a turbo incomplete task and all turbo slots are full, preempt
        if (wasTurbo && !this.scheduler.hasFreeTurboSlot()) {
            this.preemptForTurboSlot();
        }
        const downloadedBytes = state.chunks.reduce((s, c) => s + c.downloaded, 0);
        const task = {
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
            turboPriority: wasTurbo,
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
        // Clean up .turbo file if it exists
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
    /** Return disk environment info for a given folder (usable before any download starts). */
    async getEnvironmentInfo(savePath) {
        return this.diskManager.getEnvironmentInfo(savePath);
    }
    // ─── Promotion logic ────────────────────────────────────────────────────────
    /** Called after any state change to rebalance slots. */
    refreshSlots() {
        if (!this.config.turboMode)
            return;
        this.tryPromoteNormalToTurbo();
    }
    tryPromoteNormalToTurbo() {
        if (!this.config.turboMode)
            return;
        if (!this.scheduler.hasFreeTurboSlot())
            return;
        const freeSlots = this.scheduler.getMaxTurbo() - this.scheduler.getActiveTurboCount();
        const normalIds = this.scheduler.getActiveNormalDownloadingIds();
        const candidates = [];
        for (const id of normalIds) {
            const task = this.tasks.get(id);
            if (task && task.status === "downloading") {
                candidates.push(id);
                if (candidates.length >= freeSlots)
                    break;
            }
        }
        if (candidates.length > 0) {
            // Promote all eligible tasks in parallel
            Promise.allSettled(candidates.map(id => this.promoteTask(id).catch(err => {
                console.error(`[IPSWDownloader] promoteTask(${id}) failed:`, err);
            })));
            return;
        }
        // No normal downloading task available for promotion.
        // Pull from queue directly into any remaining free turbo slots.
        while (this.scheduler.hasFreeTurboSlot()) {
            if (!this.scheduler.tryFillTurboSlotFromQueue())
                break;
        }
    }
    async promoteTask(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "downloading")
            return;
        const cm = this.chunkManagers.get(id);
        if (!cm)
            return;
        const state = this.states.get(id) ?? this.stateManager.load(id);
        if (!state)
            return;
        const turboPath = this.buildTurboPath(task.firmware, task.savePath);
        // Determine turbo connection count
        const isHDD = !(await this.diskManager.detectSSD(task.savePath));
        const baseMaxConn = isHDD
            ? Math.min(8, this.config.maxConnectionsPerTask)
            : this.config.maxConnectionsPerTask;
        const turboMaxConn = Math.round(baseMaxConn * this.config.turboConnectionsMultiplier);
        // Promote in scheduler first (atomically moves slot)
        const promoted = this.scheduler.promoteNormalToTurbo(id);
        if (!promoted)
            return;
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
    async runDownload(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        // Capture generation to guard against stale catch blocks
        const gen = (this.runGenerations.get(id) ?? 0) + 1;
        this.runGenerations.set(id, gen);
        try {
            this.updateTaskStatus(id, "downloading");
            this.emit("started", id, task);
            // Step 1: HEAD metadata
            const meta = await chunk_manager_1.ChunkManager.fetchMetadata(task.firmware.url);
            // Step 2: Choose tmp directory
            const isHDD = !(await this.diskManager.detectSSD(task.savePath));
            const tmpDir = await this.diskManager.chooseTmpDir(task.savePath, task.firmware.filesize, task.firmware.filesize, this.config.tmpDir || undefined);
            const effectiveTmpDir = tmpDir ?? path.dirname(path.resolve(task.savePath));
            const tmpDirFinal = path.join(effectiveTmpDir, "ipswManagerTmp");
            if (!fs.existsSync(tmpDirFinal))
                fs.mkdirSync(tmpDirFinal, { recursive: true });
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
            let turboHddSsd;
            if (this.config.turboMode && isHDD && this.environment === "hdd_ssd_tmp" && task.mode === "turbo") {
                const turboPath = this.buildTurboPath(task.firmware, task.savePath);
                turboHddSsd = {
                    turboPath,
                    onTurboMove: (_info) => {
                        // During progressive move, update task progress based on move
                        // Only relevant after download completes
                    },
                    onTurboHddError: (err) => {
                        // HDD failed — degrade to SSD-only
                        console.error(`[IPSWDownloader] Turbo HDD error for ${id}:`, err.message);
                    },
                };
            }
            // Step 6: Create ChunkManager
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
            // When a normal task starts, try to promote it to turbo immediately
            // if a turbo slot is free. Runs concurrently with cm.start().
            if (this.config.turboMode && task.mode === "normal" && this.scheduler.hasFreeTurboSlot()) {
                setImmediate(() => {
                    this.promoteTask(id).catch(err => console.error(`[IPSWDownloader] Initial promoteTask(${id}) failed:`, err));
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
                const total = p.totalBytes > 0 ? p.totalBytes : state.totalSize;
                task.progress = Math.min(99, Math.floor((downloaded / total) * 100));
                task.speed = cm.getSpeed();
                task.eta = task.speed > 0 ? Math.round((total - downloaded) / task.speed) : undefined;
                this.emitThrottledProgress(id, task);
            });
            cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));
            // Step 7: Download
            await cm.start(tmpFile);
            if (task.status === "paused" || task.status === "cancelled")
                return;
            // Step 8: Verify integrity
            if (!this.config.skipVerify) {
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
            }
            // Step 9: Move tmp → final (or finish progressive turbo move)
            const finalPath = this.buildFinalPath(task.firmware, task.savePath);
            if (cm.isTurboHddSsd()) {
                // Turbo HDD+SSD: chunks were progressively moved to .turbo during
                // download. Drain remaining queued chunks, then rename .turbo → final.
                this.updateTaskStatus(id, "moving");
                // Start progress from already-moved bytes (not 0)
                const initialMoved = cm.getTotalMovedBytes();
                task.progress = state.totalSize > 0
                    ? Math.floor((initialMoved / state.totalSize) * 100)
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
                    ? Math.min(99, Math.floor((totalMoved / state.totalSize) * 100))
                    : 100;
                this.emitThrottledProgress(id, task);
                const turboPath = cm.getTurboPath();
                // Verify all completed chunks are in movedChunks
                const stateReloaded = this.stateManager.load(id);
                const completedIndices = (stateReloaded?.chunks ?? [])
                    .filter(c => c.completed)
                    .map(c => c.index);
                const movedSet = new Set(stateReloaded?.movedChunks ?? []);
                const allMoved = completedIndices.every(i => movedSet.has(i));
                if (allMoved) {
                    // All chunks accounted for — rename .turbo → final in one shot
                    try {
                        fs.unlinkSync(finalPath);
                    }
                    catch { }
                    fs.renameSync(turboPath, finalPath);
                }
                else {
                    // Some chunks weren't moved — fallback to MoveQueue (tmp → final).
                    // Clean up the incomplete .turbo file.
                    cm.cleanupTurboFile();
                    this.emit("log", id, `Turbo move incomplete (${movedSet.size}/${completedIndices.length} chunks), falling back to MoveQueue`);
                    await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, true, ({ pct, speed, eta }) => {
                        task.progress = pct;
                        task.speed = speed;
                        task.eta = eta;
                        this.emitThrottledProgress(id, task);
                    });
                }
            }
            else {
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
        }
        catch (err) {
            // Stale runDownload — pause/cancel/resume bumped the generation
            if (this.runGenerations.get(id) !== gen)
                return;
            this.updateTaskStatus(id, "error");
            task.error = err.message;
            this.emit("error", id, err.message, task);
            this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
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
            createdAt: Date.now(), updatedAt: Date.now(),
            mode,
            movedChunks: [],
        };
    }
    buildFinalPath(firmware, savePath) {
        const filename = this.extractFilename(firmware);
        if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
            return path.join(savePath, filename);
        }
        return savePath;
    }
    buildTurboPath(firmware, savePath) {
        const filename = this.extractFilename(firmware);
        const dir = fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()
            ? savePath
            : path.dirname(savePath);
        return path.join(dir, `${filename}.turbo`);
    }
    extractFilename(firmware) {
        try {
            const pathname = new url_1.URL(firmware.url).pathname;
            const name = pathname.split('/').pop();
            if (name)
                return name;
        }
        catch { }
        return `${firmware.identifier}_${firmware.buildid}.ipsw`;
    }
    updateTaskStatus(id, status) {
        const task = this.tasks.get(id);
        if (task)
            task.status = status;
    }
    emitProgressNow(id, task) {
        const state = this.progressEmitState.get(id);
        if (state?.timer) {
            clearTimeout(state.timer);
        }
        this.progressEmitState.delete(id);
        this.emit("progress", id, task);
    }
    emitThrottledProgress(id, task) {
        const now = Date.now();
        const prev = this.progressEmitState.get(id);
        const progressChanged = !prev || Math.abs(task.progress - prev.lastProgress) >= this.progressEmitMinDelta;
        const shouldFlushNow = !prev || progressChanged || (now - prev.lastAt) >= this.progressEmitIntervalMs;
        if (shouldFlushNow) {
            if (prev?.timer)
                clearTimeout(prev.timer);
            this.progressEmitState.set(id, { lastAt: now, lastProgress: task.progress, timer: null, pending: null });
            this.emit("progress", id, task);
            return;
        }
        if (!prev)
            return;
        prev.pending = { ...task };
        if (!prev.timer) {
            const delay = Math.max(0, this.progressEmitIntervalMs - (now - prev.lastAt));
            prev.timer = setTimeout(() => {
                const current = this.progressEmitState.get(id);
                if (!current)
                    return;
                const pending = current.pending;
                this.progressEmitState.delete(id);
                if (pending)
                    this.emit("progress", id, pending);
            }, delay);
        }
    }
    cleanupRuntime(id, options) {
        const progressState = this.progressEmitState.get(id);
        if (progressState?.timer)
            clearTimeout(progressState.timer);
        this.progressEmitState.delete(id);
        if (options.releaseSpace) {
            this.diskManager.releaseSpace(id);
        }
        const state = this.states.get(id) ?? this.stateManager.load(id);
        if (options.deleteTmpFile && state?.tmpPath && fs.existsSync(state.tmpPath)) {
            try {
                fs.unlinkSync(state.tmpPath);
            }
            catch { }
        }
        // Clean up .turbo file if it exists
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.cleanupTurboFile();
        if (options.deleteStateFile) {
            this.stateManager.delete(id);
        }
        this.states.delete(id);
        this.chunkManagers.delete(id);
        this.runGenerations.delete(id);
        if (options.deleteTask) {
            this.tasks.delete(id);
        }
    }
}
exports.IPSWDownloader = IPSWDownloader;
