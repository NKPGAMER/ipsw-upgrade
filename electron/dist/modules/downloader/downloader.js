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
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const events_1 = require("events");
const crypto_1 = require("crypto");
const url_1 = require("url");
const disk_manager_1 = require("./disk-manager");
const state_manager_1 = require("./state-manager");
const chunk_manager_1 = require("./chunk-manager");
const scheduler_1 = require("./scheduler");
const integrity_1 = require("./integrity");
const GB = 1024 ** 3;
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB
// ─── Move Queue ───────────────────────────────────────────────────────────────
// Serializes move operations per destination drive to prevent concurrent HDD writes.
// SSD destinations allow up to 2 parallel moves; HDD is strictly sequential (1 at a time).
class MoveQueue {
    diskManager;
    // key = drive root (e.g. "C:\" on Windows, "/dev/sdb" on Linux)
    queues = new Map();
    concurrency = new Map(); // active count per drive
    hddLimit = 2;
    ssdLimit = 3;
    constructor(diskManager) {
        this.diskManager = diskManager;
    }
    async enqueue(src, dest, isHDD, onProgress) {
        const key = this.driveKey(dest);
        const limit = isHDD ? this.hddLimit : this.ssdLimit;
        // Chain onto existing promise for this drive (serializes per drive on HDD)
        const prev = this.queues.get(key) ?? Promise.resolve();
        const next = prev.then(() => this.runWhenSlotOpen(key, limit, src, dest, onProgress));
        // Store the unchained promise so future tasks chain correctly
        this.queues.set(key, next.catch(() => { }));
        return next;
    }
    async runWhenSlotOpen(key, limit, src, dest, onProgress) {
        // Wait until concurrency slot is free
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
                onProgress(100);
        }
        catch {
            // Cross-device: stream copy
            await this.copyStream(src, dest, onProgress);
            fs.unlinkSync(src);
        }
    }
    copyStream(src, dest, onProgress) {
        return new Promise((resolve, reject) => {
            const totalSize = fs.statSync(src).size;
            let copied = 0;
            const rs = fs.createReadStream(src, { highWaterMark: 64 * 1024 * 1024 });
            const ws = fs.createWriteStream(dest);
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
        if (process.platform === "win32") {
            return path.parse(resolved).root.toUpperCase(); // "C:\"
        }
        // Linux/macOS: use first 2 path segments as proxy for mount point
        const parts = resolved.split(path.sep).filter(Boolean);
        return path.sep + (parts[0] ?? "");
    }
}
class IPSWDownloader extends events_1.EventEmitter {
    config;
    tasks = new Map();
    states = new Map();
    chunkManagers = new Map();
    diskManager;
    stateManager;
    scheduler;
    integrity;
    abortControllers = new Map();
    moveQueue;
    win;
    constructor(win, config = {}) {
        super();
        this.win = win;
        if (win)
            this.registerIPC();
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
            adaptiveBuffer: config.adaptiveBuffer ?? false,
            skipVerify: config.skipVerify ?? false
        };
        const stateDir = path.join(process.cwd(), ".ipsw-state");
        this.diskManager = new disk_manager_1.DiskManager();
        this.moveQueue = new MoveQueue(this.diskManager);
        this.stateManager = new state_manager_1.StateManager(stateDir);
        this.scheduler = new scheduler_1.Scheduler(this.config.maxConcurrentTasks);
        this.integrity = new integrity_1.IntegrityChecker();
        this.scheduler.on("started", (id) => {
            this.updateTaskStatus(id, "downloading");
        });
    }
    // ─── PUBLIC API ────────────────────────────────────────────────────────────
    async add(firmware, savePath) {
        // Validate URL
        try {
            new url_1.URL(firmware.url);
        }
        catch {
            return { success: false, error: "INVALID_URL" };
        }
        // Check duplicate
        for (const task of this.tasks.values()) {
            if (task.firmware.identifier === firmware.identifier &&
                task.firmware.buildid === firmware.buildid) {
                return { success: false, error: "ALREADY_IN_LIST" };
            }
        }
        // Check disk space
        const spaceCheck = await this.diskManager.hasEnoughSpace(savePath, firmware.filesize, this.config.diskBufferGB * GB);
        if (!spaceCheck.ok) {
            return { success: false, error: "DISK_FULL" };
        }
        const id = (0, crypto_1.randomUUID)();
        // Reserve space
        this.diskManager.reserveSpace(id, firmware.filesize);
        // Create task
        const task = {
            id,
            firmware,
            progress: 0,
            speed: 0,
            status: "queued",
            savePath,
        };
        this.tasks.set(id, task);
        // Schedule
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
        });
        this.sendEvent("added", id, task);
        return { success: true, id };
    }
    pause(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "downloading")
            return;
        // Abort the chunk manager
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.abort();
        this.scheduler.pauseTask(id);
        this.updateTaskStatus(id, "paused");
        this.sendEvent("paused", id, task);
    }
    resume(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "paused")
            return;
        this.updateTaskStatus(id, "queued");
        // Re-enqueue (will re-use saved state)
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
        });
        this.scheduler.resumeTask(id);
        this.sendEvent("resumed", id, this.tasks.get(id));
    }
    cancel(id) {
        const cm = this.chunkManagers.get(id);
        if (cm)
            cm.abort();
        this.scheduler.cancelTask(id);
        this.diskManager.releaseSpace(id);
        // Clean up files
        const state = this.states.get(id);
        if (state) {
            if (state.tmpPath && fs.existsSync(state.tmpPath)) {
                try {
                    fs.unlinkSync(state.tmpPath);
                }
                catch { }
            }
        }
        this.stateManager.delete(id);
        this.tasks.delete(id);
        this.states.delete(id);
        this.chunkManagers.delete(id);
        this.sendEvent("cancelled", id);
    }
    getAllTask() {
        // Update speed from active chunk managers
        for (const [id, cm] of this.chunkManagers.entries()) {
            const task = this.tasks.get(id);
            if (task && task.status === "downloading") {
                task.speed = cm.getSpeed();
            }
        }
        return Array.from(this.tasks.values());
    }
    /**
     * Return all incomplete downloads persisted on disk
     * (tasks that were interrupted and not yet resumed in this session)
     */
    getIncompleteTasks() {
        const allStates = this.stateManager.listAll();
        return allStates
            .filter(s => !this.tasks.has(s.id)) // exclude already-active tasks
            .map(s => {
            const downloadedBytes = s.chunks.reduce((sum, c) => sum + c.downloaded, 0);
            const progress = s.totalSize > 0
                ? Math.floor((downloadedBytes / s.totalSize) * 100)
                : 0;
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
            .sort((a, b) => b.savedAt - a.savedAt); // most recent first
    }
    /**
     * Resume an incomplete task from a previous session.
     * The saved state (chunks + tmp file) will be reused — no re-download from scratch.
     */
    resumeIncomplete(id) {
        // Already active?
        if (this.tasks.has(id))
            return { success: false, error: "ALREADY_ACTIVE" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        // Re-register task so it appears in getAllTask()
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
        this.scheduler.enqueue({
            id,
            run: () => this.runDownload(id),
        });
        this.sendEvent("added", id, task);
        return { success: true };
    }
    /**
     * Permanently delete an incomplete task — removes state file and tmp data.
     */
    deleteIncomplete(id) {
        // Cannot delete an active/downloading task — use cancel() instead
        if (this.tasks.has(id))
            return { success: false, error: "USE_CANCEL_FOR_ACTIVE_TASK" };
        const state = this.stateManager.load(id);
        if (!state)
            return { success: false, error: "STATE_NOT_FOUND" };
        // Delete tmp file
        if (state.tmpPath && fs.existsSync(state.tmpPath)) {
            try {
                fs.unlinkSync(state.tmpPath);
            }
            catch { /* ignore */ }
        }
        this.stateManager.delete(id);
        this.sendEvent("incomplete_deleted", id);
        return { success: true };
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    // ─── DOWNLOAD ORCHESTRATION ────────────────────────────────────────────────
    async runDownload(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        try {
            this.updateTaskStatus(id, "downloading");
            // Step 1: Metadata (HEAD request)
            const meta = await this.fetchMetadata(task.firmware.url);
            // Step 2: Choose tmp directory
            const isHDD = !(await this.diskManager.detectSSD(task.savePath));
            const tmpDir = await this.diskManager.chooseTmpDir(task.savePath, task.firmware.filesize, this.config.tmpDir || undefined);
            const tmpFile = path.join(tmpDir, `${id}.ipsw.tmp`);
            // Step 3: Load or create download state
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
                adaptiveBuffer: this.config.adaptiveBuffer,
            });
            this.chunkManagers.set(id, cm);
            // Wire progress events
            cm.on("progress", (p) => {
                const downloaded = p.bytesWritten;
                const total = p.totalBytes > 0 ? p.totalBytes : state.totalSize;
                task.progress = Math.min(99, Math.floor((downloaded / total) * 100));
                const speed = cm.getSpeed();
                task.speed = speed;
                if (speed > 0) {
                    const remaining = total - downloaded;
                    const rawEta = remaining / speed; // giây
                    // ETA smoothing riêng: alpha nhỏ hơn speed để ETA đổi chậm hơn
                    const ETA_ALPHA = 0.1;
                    task.eta = task.eta != null && task.eta > 0
                        ? Math.round(ETA_ALPHA * rawEta + (1 - ETA_ALPHA) * task.eta)
                        : Math.round(rawEta);
                }
                this.sendEvent("progress", id, task);
            });
            cm.on("error", (err) => {
                console.error(`[ChunkManager][${id}] error:`, err.message);
            });
            // Step 5: Run download
            await cm.start(tmpFile);
            // Aborted mid-way
            if (task.status === "paused")
                return;
            // Step 6: Verify integrity
            if (!this.config.skipVerify) {
                this.updateTaskStatus(id, "verifying");
                task.speed = 0;
                this.sendEvent("progress", id, task);
                const result = await this.integrity.verify(tmpFile, task.firmware, (pct) => {
                    task.progress = pct; // 0–100 during verify
                    this.sendEvent("progress", id, task);
                });
                if (!result.ok) {
                    fs.unlinkSync(tmpFile);
                    this.stateManager.delete(id);
                    this.updateTaskStatus(id, "error");
                    task.error = `Checksum mismatch (${result.algo}): expected ${result.expected}, got ${result.actual}`;
                    this.sendEvent("error", id, task.error, task);
                    return;
                }
            }
            // Step 7: Move tmp → savePath (serialized per drive to protect HDD)
            this.updateTaskStatus(id, "moving");
            task.progress = 0;
            this.sendEvent("progress", id, task);
            const finalPath = this.buildFinalPath(task.firmware, task.savePath);
            await this.moveQueue.enqueue(tmpFile, finalPath, isHDD, (pct) => {
                task.progress = pct;
                this.sendEvent("progress", id, task);
            });
            // Done
            this.diskManager.releaseSpace(id);
            this.stateManager.delete(id);
            this.chunkManagers.delete(id);
            task.progress = 100;
            task.speed = 0;
            this.updateTaskStatus(id, "completed");
            this.sendEvent("completed", id, task);
        }
        catch (err) {
            if (task.status === "paused")
                return; // Intentional abort
            this.updateTaskStatus(id, "error");
            task.error = err.message;
            this.sendEvent("error", id, err.message, task);
        }
    }
    // ─── HELPERS ──────────────────────────────────────────────────────────────
    async fetchMetadata(url) {
        return new Promise((resolve, reject) => {
            const parsed = new url_1.URL(url);
            const lib = parsed.protocol === "https:" ? https : http;
            const req = lib.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: "HEAD",
                headers: { "User-Agent": "iLog-Downloader/1.0" },
                timeout: 15000,
            }, (res) => {
                const contentLength = parseInt(res.headers["content-length"] || "0");
                const acceptsRanges = res.headers["accept-ranges"] === "bytes";
                res.destroy();
                resolve({ contentLength, acceptsRanges });
            });
            req.on("error", reject);
            req.on("timeout", () => { req.destroy(); reject(new Error("HEAD request timeout")); });
            req.end();
        });
    }
    buildState(id, firmware, savePath, tmpPath, meta) {
        const totalSize = meta.contentLength || firmware.filesize;
        const supportsRanges = meta.acceptsRanges;
        const chunks = [];
        if (supportsRanges && totalSize > 0) {
            let offset = 0;
            let index = 0;
            while (offset < totalSize) {
                const end = Math.min(offset + this.config.chunkSize - 1, totalSize - 1);
                chunks.push({ index, start: offset, end, downloaded: 0, completed: false });
                offset = end + 1;
                index++;
            }
        }
        else {
            // Single chunk fallback
            chunks.push({ index: 0, start: 0, end: totalSize - 1, downloaded: 0, completed: false });
        }
        return {
            id,
            firmware,
            savePath,
            tmpPath,
            totalSize,
            chunks,
            supportsRanges,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }
    calculateDownloaded(state) {
        return state.chunks.reduce((sum, c) => sum + c.downloaded, 0);
    }
    buildFinalPath(firmware, savePath) {
        const filename = firmware.url.split("/").pop() || `${firmware.identifier}_${firmware.buildid}.ipsw`;
        if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
            return path.join(savePath, filename);
        }
        return savePath;
    }
    /**
     * Send event to Electron renderer via webContents.send,
     * and also emit on EventEmitter for any Node-side listeners.
     */
    sendEvent(channel, ...args) {
        if (this.win && !this.win.isDestroyed()) {
            this.win.webContents.send(`dm:${channel}`, ...args);
        }
        super.emit(channel, ...args);
    }
    /**
     * Register IPC handlers so the renderer can call downloader methods directly.
     * All handlers are prefixed with "dm:" to avoid collisions.
     *
     * Renderer usage (via ipcRenderer.invoke):
     *   ipcRenderer.invoke("dm:add", firmware, savePath)
     *   ipcRenderer.invoke("dm:pause", id)
     *   ipcRenderer.invoke("dm:resume", id)
     *   ipcRenderer.invoke("dm:cancel", id)
     *   ipcRenderer.invoke("dm:getAllTask")
     *   ipcRenderer.invoke("dm:getIncompleteTasks")
     *   ipcRenderer.invoke("dm:resumeIncomplete", id)
     *   ipcRenderer.invoke("dm:deleteIncomplete", id)
     */
    registerIPC() {
        // Lazy import ipcMain so this file stays importable outside Electron
        // (e.g. in tests or pure Node environments)
        let ipcMain;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            ipcMain = require("electron").ipcMain;
        }
        catch {
            console.warn("[IPSWDownloader] electron not available — IPC not registered");
            return;
        }
        ipcMain.handle("dm:add", (_e, firmware, savePath) => this.add(firmware, savePath));
        ipcMain.handle("dm:pause", (_e, id) => {
            this.pause(id);
        });
        ipcMain.handle("dm:resume", (_e, id) => {
            this.resume(id);
        });
        ipcMain.handle("dm:cancel", (_e, id) => {
            this.cancel(id);
        });
        ipcMain.handle("dm:getAllTask", () => this.getAllTask());
        ipcMain.handle("dm:getIncompleteTasks", () => this.getIncompleteTasks());
        ipcMain.handle("dm:resumeIncomplete", (_e, id) => this.resumeIncomplete(id));
        ipcMain.handle("dm:deleteIncomplete", (_e, id) => this.deleteIncomplete(id));
    }
    updateTaskStatus(id, status) {
        const task = this.tasks.get(id);
        if (task)
            task.status = status;
    }
}
exports.IPSWDownloader = IPSWDownloader;
