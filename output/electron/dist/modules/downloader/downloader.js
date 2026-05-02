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
 *  - MoveQueue.copyStream: reports progress while copying tmp -> final file
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWDownloader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const events_1 = require("events");
const crypto_1 = require("crypto");
const url_1 = require("url");
const fs_extra_1 = __importDefault(require("fs-extra"));
const disk_manager_1 = require("./disk-manager");
const state_manager_1 = require("./state-manager");
const chunk_manager_1 = require("./chunk-manager");
const scheduler_1 = require("./scheduler");
const integrity_1 = require("./integrity");
const GB = 1024 ** 3;
class MoveQueue {
    stateByDrive = new Map();
    hddLimit = 1;
    ssdLimit = 2;
    constructor() { }
    async enqueue(src, dest, isHDD, onProgress) {
        const key = this.driveKey(dest);
        return new Promise((resolve, reject) => {
            const state = this.getState(key);
            state.queue.push({
                order: state.nextOrder++,
                src,
                dest,
                onProgress,
                resolve,
                reject,
            });
            state.queue.sort((a, b) => a.order - b.order);
            this.drain(key, isHDD);
        });
    }
    drain(key, isHDD) {
        const state = this.stateByDrive.get(key);
        if (!state)
            return;
        const limit = isHDD ? this.hddLimit : this.ssdLimit;
        while (state.active < limit && state.queue.length > 0) {
            state.queue.sort((a, b) => a.order - b.order);
            const job = state.queue.shift();
            if (!job)
                break;
            state.active += 1;
            this.runJob(job)
                .then(job.resolve)
                .catch(job.reject)
                .finally(() => {
                state.active -= 1;
                if (state.active < 0)
                    state.active = 0;
                this.cleanupState(key);
                this.drain(key, isHDD);
            });
        }
    }
    async runJob(job) {
        const { src, dest, onProgress } = job;
        const destDir = path.dirname(dest);
        await fs.promises.mkdir(destDir, { recursive: true });
        try {
            await fs.promises.rename(src, dest);
            if (onProgress)
                onProgress({ pct: 100, speed: 0, eta: 0 });
            return;
        }
        catch { /* cross-device — fall through */ }
        await this.copyFast(src, dest, onProgress);
        await fs.promises.unlink(src).catch(() => { });
    }
    async copyFast(src, dest, onProgress) {
        const stat = await fs.promises.stat(src);
        const totalSize = stat.size;
        const startedAt = Date.now();
        const highWaterMark = this.getMoveBufferSize(totalSize, this.getAvailableMemoryBytes());
        await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(src, {
                highWaterMark,
                autoClose: true,
            });
            const writeStream = fs.createWriteStream(dest, {
                flags: "w",
                highWaterMark,
                autoClose: true,
            });
            let copied = 0;
            let lastEmitAt = 0;
            let lastPct = -1;
            const emitProgress = () => {
                if (!onProgress || totalSize <= 0)
                    return;
                const now = Date.now();
                const pct = Math.min(99, Math.floor((copied / totalSize) * 100));
                const elapsedSec = Math.max((now - startedAt) / 1000, 0.001);
                const speed = copied / elapsedSec;
                const eta = speed > 0 ? Math.max(0, Math.round((totalSize - copied) / speed)) : undefined;
                if (pct !== lastPct || now - lastEmitAt >= 120 || copied === totalSize) {
                    lastEmitAt = now;
                    lastPct = pct;
                    onProgress({ pct, speed, eta });
                }
            };
            readStream.on("data", (chunk) => {
                copied += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
                emitProgress();
            });
            readStream.on("error", reject);
            writeStream.on("error", reject);
            writeStream.on("close", () => resolve());
            readStream.pipe(writeStream);
        });
        await fs.promises.utimes(dest, new Date(), new Date()).catch(() => { });
        if (onProgress)
            onProgress({ pct: 100, speed: totalSize, eta: 0 });
    }
    getState(key) {
        let state = this.stateByDrive.get(key);
        if (!state) {
            state = { active: 0, nextOrder: 0, queue: [] };
            this.stateByDrive.set(key, state);
        }
        return state;
    }
    cleanupState(key) {
        const state = this.stateByDrive.get(key);
        if (state && state.active <= 0 && state.queue.length === 0) {
            this.stateByDrive.delete(key);
        }
    }
    getMoveBufferSize(totalSize, availableMemoryBytes) {
        const mb = 1024 * 1024;
        const fileBased = totalSize <= 128 * mb ? 16 * mb :
            totalSize <= 512 * mb ? 32 * mb :
                totalSize <= 2 * GB ? 64 * mb :
                    totalSize <= 8 * GB ? 96 * mb :
                        128 * mb;
        const memoryBudget = Math.max(32 * mb, Math.floor(availableMemoryBytes * 0.05));
        const memoryAware = Math.max(16 * mb, Math.min(fileBased, memoryBudget));
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
    constructor(stateDir, config = {}) {
        super();
        this.config = {
            maxConcurrentTasks: config.maxConcurrentTasks ?? 3,
            maxConnectionsPerTask: config.maxConnectionsPerTask ?? 48,
            initialConnectionsPerTask: config.initialConnectionsPerTask ?? 12,
            chunkSize: config.chunkSize ?? (64 * 1024 * 1024),
            retryLimit: config.retryLimit ?? 3,
            retryDelay: config.retryDelay ?? 1000,
            diskBufferGB: config.diskBufferGB ?? 5,
            bandwidthLimitBps: config.bandwidthLimitBps ?? 0,
            tmpDir: config.tmpDir ?? "",
            skipVerify: config.skipVerify ?? false,
        };
        this.diskManager = new disk_manager_1.DiskManager();
        this.moveQueue = new MoveQueue();
        this.stateManager = new state_manager_1.StateManager(stateDir);
        this.scheduler = new scheduler_1.Scheduler(this.config.maxConcurrentTasks);
        this.integrity = new integrity_1.IntegrityChecker();
        this.scheduler.on("started", (id) => this.updateTaskStatus(id, "downloading"));
    }
    // ─── PUBLIC API ──────────────────────────────────────────────────────────────
    async add(firmware, savePath, config = {}) {
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
                (task.status === 'downloading' || task.status === 'moving' || task.status === 'verifying' || task.status === 'queued' || task.status === 'paused'))
                return { success: false, error: "ALREADY_IN_LIST" };
        }
        if (config.deleteFiles?.length) {
            await Promise.all(config.deleteFiles.map(async (file) => {
                if (file?.path && await fs_extra_1.default.pathExists(file.path)) {
                    await fs.promises.unlink(file.path).catch(() => { });
                }
            }));
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
        void this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
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
    async getIncompleteTasks() {
        const tasks = await Promise.all(this.stateManager.listAll()
            .filter(s => !this.tasks.has(s.id))
            .map(async (s) => {
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
                tmpExists: await fs_extra_1.default.pathExists(s.tmpPath),
                savedAt: s.updatedAt,
            };
        }));
        return tasks.sort((a, b) => b.savedAt - a.savedAt);
    }
    async resumeIncomplete(id) {
        if (this.tasks.has(id))
            return { success: false, error: "ALREADY_ACTIVE" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        // ── Check if the .ipsw.tmp file still exists on disk ─────────────────────
        const tmpExists = !!(state.tmpPath && await fs_extra_1.default.pathExists(state.tmpPath));
        if (!tmpExists) {
            // Tmp file is gone — reset chunk progress so the download starts from 0
            console.log(`[IPSWDownloader] resumeIncomplete(${id}): tmp file not found at "${state.tmpPath}", ` +
                `resetting ${state.chunks.length} chunks for a fresh download.`);
            for (const chunk of state.chunks) {
                chunk.downloaded = 0;
                chunk.completed = false;
            }
            // Persist the reset so ChunkManager sees clean state
            this.stateManager.save(state);
        }
        // ─────────────────────────────────────────────────────────────────────────
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
        };
        this.tasks.set(id, task);
        this.states.set(id, state);
        this.diskManager.reserveSpace(id, state.firmware.filesize);
        this.scheduler.enqueue({ id, run: () => this.runDownload(id) });
        this.emit("added", id, task);
        return { success: true };
    }
    async deleteIncomplete(id) {
        if (this.tasks.has(id))
            return { success: false, error: "USE_CANCEL_FOR_ACTIVE_TASK" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        if (state.tmpPath && await fs_extra_1.default.pathExists(state.tmpPath)) {
            await fs.promises.unlink(state.tmpPath).catch(() => { });
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
            this.emit("started", id, task);
            // Step 1: HEAD metadata (via undici in ChunkManager.fetchMetadata)
            const meta = await chunk_manager_1.ChunkManager.fetchMetadata(task.firmware.url);
            // Step 1b: Probe CDN behavior in the first few seconds to estimate
            // how much parallelism it can actually benefit from.
            const probe = await this.probeCdn(task.firmware.url, meta.acceptsRanges);
            // Step 2: Choose tmp directory
            const isHDD = !(await this.diskManager.detectSSD(task.savePath));
            const tmpDir = await this.diskManager.chooseTmpDir(task.savePath, task.firmware.filesize, this.config.tmpDir || undefined);
            const tmpFile = path.join(tmpDir, `${id}.ipsw.tmp`);
            const plannedChunkSize = this.selectChunkSize(task.firmware.filesize, probe.targetParts);
            // Step 3: Load or create state
            let state = this.stateManager.load(id);
            if (!state) {
                state = this.buildState(id, task.firmware, task.savePath, tmpFile, meta);
                this.stateManager.save(state);
            }
            this.states.set(id, state);
            // Step 4: Create ChunkManager
            const cap = isHDD ? 8 : this.config.maxConnectionsPerTask;
            const maxConn = Math.max(probe.recommendedConnections, Math.min(cap, probe.targetParts));
            const initialConn = Math.min(this.config.initialConnectionsPerTask, maxConn);
            const cm = new chunk_manager_1.ChunkManager(state, this.stateManager, {
                maxConnections: maxConn,
                initialConnections: initialConn,
                chunkSize: plannedChunkSize,
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
                task.eta = task.speed > 0 ? Math.round((total - downloaded) / task.speed) : undefined;
                this.emitThrottledProgress(id, task);
            });
            cm.on("error", (err) => console.error(`[ChunkManager][${id}]`, err.message));
            // Step 5: Download
            await cm.start(tmpFile);
            if (task.status === "paused" || task.status === "cancelled")
                return;
            // Step 6: Verify integrity
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
                    await this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: true });
                    return;
                }
            }
            // Step 7: Move tmp → final path
            this.updateTaskStatus(id, "moving");
            task.progress = 0;
            task.speed = 0;
            task.eta = undefined;
            this.emitProgressNow(id, task);
            const finalPath = await this.buildFinalPath(task.firmware, task.savePath);
            await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, ({ pct, speed, eta }) => {
                task.progress = pct;
                task.speed = speed;
                task.eta = eta;
                this.emitThrottledProgress(id, task);
            });
            // Done
            task.progress = 100;
            task.speed = 0;
            task.eta = 0;
            this.updateTaskStatus(id, "completed");
            this.emitProgressNow(id, task);
            this.emit("completed", id, task);
            await this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: true, deleteStateFile: true, deleteTask: false });
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
            await this.cleanupRuntime(id, { releaseSpace: true, deleteTmpFile: false, deleteStateFile: false, deleteTask: true });
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
    buildState(id, firmware, savePath, tmpPath, meta) {
        const totalSize = meta.contentLength || firmware.filesize;
        const supportsRanges = meta.acceptsRanges;
        const chunks = [];
        if (supportsRanges && totalSize > 0) {
            const layout = this.buildChunkLayout(totalSize);
            for (const chunk of layout)
                chunks.push(chunk);
        }
        else {
            chunks.push({
                index: 0,
                start: 0,
                end: totalSize - 1,
                size: totalSize,
                priority: 0,
                downloaded: 0,
                completed: false,
            });
        }
        return {
            id, firmware, savePath, tmpPath, totalSize, chunks, supportsRanges,
            createdAt: Date.now(), updatedAt: Date.now(),
        };
    }
    buildChunkLayout(totalSize) {
        const chunkSize = this.selectChunkSize(totalSize);
        const chunks = [];
        let offset = 0;
        let index = 0;
        while (offset < totalSize) {
            const size = Math.min(totalSize - offset, chunkSize);
            const end = offset + size - 1;
            chunks.push({
                index,
                start: offset,
                end,
                size,
                priority: index,
                downloaded: 0,
                completed: false,
            });
            offset = end + 1;
            index += 1;
        }
        return chunks;
    }
    selectChunkSize(totalSize, targetParts = 16) {
        const minChunk = Math.max(8 * 1024 * 1024, this.config.chunkSize);
        if (totalSize <= 0)
            return minChunk;
        const ideal = Math.floor(totalSize / Math.max(1, targetParts));
        if (totalSize < 512 * 1024 * 1024)
            return Math.max(16 * 1024 * 1024, ideal || minChunk);
        if (totalSize < 2 * GB)
            return Math.max(32 * 1024 * 1024, ideal || minChunk);
        if (totalSize < 6 * GB)
            return Math.max(64 * 1024 * 1024, ideal || minChunk);
        return Math.max(128 * 1024 * 1024, ideal || minChunk);
    }
    async buildFinalPath(firmware, savePath) {
        const filename = firmware.url.split("/").pop() || `${firmware.identifier}_${firmware.buildid}.ipsw`;
        if (await fs_extra_1.default.pathExists(savePath)) {
            const stats = await fs.promises.stat(savePath);
            if (stats.isDirectory()) {
                return path.join(savePath, filename);
            }
        }
        return savePath;
    }
    async probeCdn(url, acceptsRanges) {
        if (!acceptsRanges) {
            return { targetParts: 1, recommendedConnections: 1 };
        }
        const parsed = new url_1.URL(url);
        const probePool = new (await Promise.resolve().then(() => __importStar(require("undici")))).Pool(parsed.origin, {
            connections: 4,
            pipelining: 1,
            keepAliveTimeout: 15_000,
            headersTimeout: 10_000,
        });
        const sampleRanges = [
            "bytes=0-0",
            "bytes=1-1",
            "bytes=2-2",
            "bytes=3-3",
        ];
        let successful = 0;
        const startedAt = Date.now();
        try {
            await Promise.all(sampleRanges.map(async (range) => {
                try {
                    const res = await probePool.request({
                        origin: parsed.origin,
                        path: parsed.pathname + parsed.search,
                        method: "GET",
                        headers: {
                            range,
                            "user-agent": "iTunes/12.12.10",
                            "accept-encoding": "identity",
                        },
                    });
                    if (res.statusCode === 206 || res.statusCode === 200)
                        successful += 1;
                    await res.body.dump().catch(() => { });
                }
                catch {
                    // ignore probe failures
                }
            }));
        }
        finally {
            await probePool.destroy().catch(() => { });
        }
        const elapsedMs = Math.max(1, Date.now() - startedAt);
        if (successful >= 4 && elapsedMs < 600)
            return { targetParts: 16, recommendedConnections: 16 };
        if (successful >= 3 && elapsedMs < 1000)
            return { targetParts: 16, recommendedConnections: 12 };
        if (successful >= 2)
            return { targetParts: 8, recommendedConnections: 8 };
        return { targetParts: 4, recommendedConnections: 4 };
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
    async cleanupRuntime(id, options) {
        const progressState = this.progressEmitState.get(id);
        if (progressState?.timer)
            clearTimeout(progressState.timer);
        this.progressEmitState.delete(id);
        if (options.releaseSpace) {
            this.diskManager.releaseSpace(id);
        }
        const state = this.states.get(id) ?? this.stateManager.load(id);
        if (options.deleteTmpFile && state?.tmpPath && await fs_extra_1.default.pathExists(state.tmpPath)) {
            await fs.promises.unlink(state.tmpPath).catch(() => { });
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
