"use strict";
/**
 * downloader.ts
 *
 * IPSWDownloader — runs entirely inside the worker thread.
 * No Electron imports here. Communication with main thread happens via
 * worker_threads.parentPort (see downloader-worker.ts).
 *
 * Changes vs original:
 *  - undici used via ChunkManager.fetchMetadata
 *  - cancel(): sets task.status = "cancelled" BEFORE calling cm.abort()
 *  - runDownload(): catch block silently returns when status === "cancelled"
 *  - MoveQueue.copyStream: uses fs.promises.copyFile (kernel-level) for same-device,
 *    falls back to streaming copy with 64 MB highWaterMark for cross-device
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
exports.IPSWDownloader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
    diskManager;
    queues = new Map();
    concurrency = new Map();
    hddLimit = 2;
    ssdLimit = 3;
    constructor(diskManager) {
        this.diskManager = diskManager;
    }
    async enqueue(src, dest, isHDD, onProgress) {
        const key = this.driveKey(dest);
        const limit = isHDD ? this.hddLimit : this.ssdLimit;
        const prev = this.queues.get(key) ?? Promise.resolve();
        const next = prev.then(() => this.runWhenSlotOpen(key, limit, src, dest, onProgress));
        this.queues.set(key, next.catch(() => { }));
        return next;
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
        // Try atomic rename first (same filesystem — instant, no I/O)
        try {
            fs.renameSync(src, dest);
            if (onProgress)
                onProgress(100);
            return;
        }
        catch { /* cross-device — fall through */ }
        // Cross-device: try kernel-level copy (sendfile / CopyFileEx) then unlink
        try {
            await fs.promises.copyFile(src, dest);
            fs.unlinkSync(src);
            if (onProgress)
                onProgress(100);
        }
        catch {
            // Last resort: manual streaming copy (e.g. FAT32 destination)
            await this.copyStream(src, dest, onProgress);
            fs.unlinkSync(src);
        }
    }
    /**
     * Streaming copy fallback — 64 MB chunks to minimize syscall overhead.
     * Uses async pipeline for non-blocking I/O.
     */
    copyStream(src, dest, onProgress) {
        return new Promise((resolve, reject) => {
            const totalSize = fs.statSync(src).size;
            let copied = 0;
            const rs = fs.createReadStream(src, { highWaterMark: 64 * 1024 * 1024 });
            const ws = fs.createWriteStream(dest, { highWaterMark: 64 * 1024 * 1024 });
            rs.on("data", (chunk) => {
                copied += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
                if (onProgress && totalSize > 0)
                    onProgress(Math.floor((copied / totalSize) * 100));
            });
            rs.pipe(ws);
            ws.on("finish", resolve);
            ws.on("error", reject);
            rs.on("error", reject);
        });
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
        };
        this.diskManager = new disk_manager_1.DiskManager();
        this.moveQueue = new MoveQueue(this.diskManager);
        this.stateManager = new state_manager_1.StateManager(stateDir);
        this.scheduler = new scheduler_1.Scheduler(this.config.maxConcurrentTasks);
        this.integrity = new integrity_1.IntegrityChecker();
        this.scheduler.on("started", (id) => this.updateTaskStatus(id, "downloading"));
    }
    // ─── PUBLIC API ──────────────────────────────────────────────────────────────
    async add(firmware, savePath) {
        try {
            new url_1.URL(firmware.url);
        }
        catch {
            return { success: false, error: "INVALID_URL" };
        }
        for (const task of this.tasks.values()) {
            if (task.firmware.identifier === firmware.identifier &&
                task.firmware.buildid === firmware.buildid)
                return { success: false, error: "ALREADY_IN_LIST" };
        }
        const spaceCheck = await this.diskManager.hasEnoughSpace(savePath, firmware.filesize, this.config.diskBufferGB * GB);
        if (!spaceCheck.ok)
            return { success: false, error: "DISK_FULL" };
        const id = (0, crypto_1.randomUUID)();
        this.diskManager.reserveSpace(id, firmware.filesize);
        const task = { id, firmware, progress: 0, speed: 0, status: "queued", savePath };
        this.tasks.set(id, task);
        this.scheduler.enqueue({ id, run: () => this.runDownload(id) });
        this.emit("added", id, task);
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
    }
    resume(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "paused")
            return;
        this.updateTaskStatus(id, "queued");
        this.scheduler.enqueue({ id, run: () => this.runDownload(id) });
        this.scheduler.resumeTask(id);
        this.emit("resumed", id, this.tasks.get(id));
    }
    cancel(id) {
        const task = this.tasks.get(id);
        // ── FIX: set cancelled BEFORE aborting so runDownload can detect it ──────
        if (task)
            this.updateTaskStatus(id, "cancelled");
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.abort();
        this.scheduler.cancelTask(id);
        this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
        this.emit("cancelled", id);
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
        const task = {
            id,
            firmware: state.firmware,
            progress: state.totalSize > 0
                ? Math.floor(state.chunks.reduce((s, c) => s + c.downloaded, 0) / state.totalSize * 100)
                : 0,
            speed: 0,
            status: "queued",
            savePath: state.savePath,
        };
        this.tasks.set(id, task);
        this.states.set(id, state);
        this.diskManager.reserveSpace(id, state.firmware.filesize);
        this.scheduler.enqueue({ id, run: () => this.runDownload(id) });
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
        this.stateManager.delete(id);
        this.emit("incomplete_deleted", id);
        return { success: true };
    }
    getTask(id) { return this.tasks.get(id); }
    // ─── DOWNLOAD ORCHESTRATION ──────────────────────────────────────────────────
    async runDownload(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        try {
            this.updateTaskStatus(id, "downloading");
            // Step 1: HEAD metadata (via undici in ChunkManager.fetchMetadata)
            const meta = await chunk_manager_1.ChunkManager.fetchMetadata(task.firmware.url);
            // Step 2: Choose tmp directory
            const isHDD = !(await this.diskManager.detectSSD(task.savePath));
            const tmpDir = await this.diskManager.chooseTmpDir(task.savePath, task.firmware.filesize, this.config.tmpDir || undefined);
            const tmpFile = path.join(tmpDir, `${id}.ipsw.tmp`);
            // Step 3: Load or create state
            let state = this.stateManager.load(id);
            if (!state) {
                state = this.buildState(id, task.firmware, task.savePath, tmpFile, meta);
                this.stateManager.save(state);
            }
            this.states.set(id, state);
            // Step 4: Create ChunkManager
            const maxConn = isHDD
                ? Math.min(8, this.config.maxConnectionsPerTask)
                : this.config.maxConnectionsPerTask;
            const cm = new chunk_manager_1.ChunkManager(state, this.stateManager, {
                maxConnections: maxConn,
                initialConnections: this.config.initialConnectionsPerTask,
                chunkSize: this.config.chunkSize,
                retryLimit: this.config.retryLimit,
                retryDelay: this.config.retryDelay,
                bandwidthLimitBps: this.config.bandwidthLimitBps,
                isHDD,
            });
            this.chunkManagers.set(id, cm);
            cm.on("progress", (p) => {
                const downloaded = p.bytesWritten;
                const total = p.totalBytes > 0 ? p.totalBytes : state.totalSize;
                task.progress = Math.min(99, Math.floor((downloaded / total) * 100));
                task.speed = cm.getSpeed();
                if (task.speed > 0)
                    task.eta = Math.round((total - downloaded) / task.speed);
                this.emit("progress", id, task);
            });
            cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));
            // Step 5: Download
            await cm.start(tmpFile);
            // ── FIX: check for cancelled or paused abort ───────────────────────────
            if (task.status === "paused")
                return;
            if (task.status === "cancelled")
                return; // silent — cancel() already emitted
            // Step 6: Verify integrity
            this.updateTaskStatus(id, "verifying");
            task.speed = 0;
            this.emit("progress", id, task);
            const result = await this.integrity.verify(tmpFile, task.firmware, (pct) => {
                task.progress = pct;
                this.emit("progress", id, task);
            });
            if (!result.ok) {
                this.updateTaskStatus(id, "error");
                task.error = `Checksum mismatch (${result.algo}): expected ${result.expected}, got ${result.actual}`;
                this.emit("error", id, task.error, task);
                this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
                return;
            }
            // Step 7: Move tmp → final path
            this.updateTaskStatus(id, "moving");
            task.progress = 0;
            this.emit("progress", id, task);
            const finalPath = this.buildFinalPath(task.firmware, task.savePath);
            await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, (pct) => {
                task.progress = pct;
                this.emit("progress", id, task);
            });
            // Done
            task.progress = 100;
            task.speed = 0;
            this.updateTaskStatus(id, "completed");
            this.emit("completed", id, task);
            this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: false });
        }
        catch (err) {
            // ── FIX: silently swallow intentional cancellation ─────────────────────
            if (task.status === "cancelled")
                return;
            if (task.status === "paused")
                return;
            this.updateTaskStatus(id, "error");
            task.error = err.message;
            this.emit("error", id, err.message, task);
            this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
    buildState(id, firmware, savePath, tmpPath, meta) {
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
        };
    }
    buildFinalPath(firmware, savePath) {
        const filename = firmware.url.split("/").pop() || `${firmware.identifier}_${firmware.buildid}.ipsw`;
        if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
            return path.join(savePath, filename);
        }
        return savePath;
    }
    updateTaskStatus(id, status) {
        const task = this.tasks.get(id);
        if (task)
            task.status = status;
    }
    cleanupRuntime(id, options) {
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
exports.IPSWDownloader = IPSWDownloader;
