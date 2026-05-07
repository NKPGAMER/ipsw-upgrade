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
exports.ChunkManager = void 0;
const fs = __importStar(require("fs"));
const url_1 = require("url");
const undici_1 = require("undici");
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB per chunk
const WRITE_HIGH_WATER = 8 * 1024 * 1024; // 8 MB — flush threshold
/** undici Pool options tuned for bulk file transfer */
function makePool(origin, maxConnections) {
    return new undici_1.Pool(origin, {
        connections: maxConnections,
        pipelining: 1,
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connect: {
            rejectUnauthorized: false,
            timeout: 15_000,
        },
        bodyTimeout: 60_000,
        headersTimeout: 15_000,
    });
}
class IOWriteQueue {
    tmpPath;
    turboPath;
    queue = [];
    active = false;
    totalMovedBytes = 0;
    stateManager;
    stateId;
    onMove;
    onError;
    totalSize;
    stopped = false;
    constructor(tmpPath, turboPath, stateManager, stateId, totalSize, onMove, onError) {
        this.tmpPath = tmpPath;
        this.turboPath = turboPath;
        this.stateManager = stateManager;
        this.stateId = stateId;
        this.totalSize = totalSize;
        this.onMove = onMove;
        this.onError = onError;
    }
    enqueue(chunk) {
        this.queue.push(chunk);
        if (!this.active && !this.stopped) {
            this.active = true;
            this.processQueue();
        }
    }
    async processQueue() {
        while (this.queue.length > 0 && !this.stopped) {
            const chunk = this.queue.shift();
            try {
                await this.moveChunk(chunk);
            }
            catch (err) {
                this.stopped = true;
                if (this.onError)
                    this.onError(err);
                this.active = false;
                return;
            }
        }
        this.active = false;
    }
    moveChunk(chunk) {
        return new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(this.tmpPath, {
                start: chunk.start,
                end: chunk.end,
                highWaterMark: 4 * 1024 * 1024, // 4MB read buffer
            });
            const writeStream = fs.createWriteStream(this.turboPath, {
                start: chunk.start,
                flags: "r+",
            });
            let moved = 0;
            readStream.on("data", (data) => {
                const len = typeof data === "string" ? Buffer.byteLength(data) : data.length;
                moved += len;
                this.totalMovedBytes += len;
                if (this.onMove) {
                    this.onMove({
                        chunkIndex: chunk.chunkIndex,
                        movedBytes: moved,
                        totalMovedBytes: this.totalMovedBytes,
                        totalSize: this.totalSize,
                    });
                }
            });
            readStream.on("error", reject);
            writeStream.on("error", reject);
            writeStream.on("finish", () => {
                // Persist movedChunks after each complete chunk (not per fragment)
                this.stateManager.addMovedChunk(this.stateId, chunk.chunkIndex);
                resolve();
            });
            readStream.pipe(writeStream);
        });
    }
    /** Abort immediately — finish the in-flight chunk then discard the rest of the queue. */
    async stop() {
        this.stopped = true;
        while (this.active) {
            await new Promise(r => setTimeout(r, 50));
        }
    }
    /** Drain every queued chunk, then return.  If the HDD errors mid-drain the
     *  stopped flag is raised and we return early — the caller checks movedChunks. */
    async drain() {
        while ((this.queue.length > 0 || this.active) && !this.stopped) {
            await new Promise(r => setTimeout(r, 100));
        }
    }
    get hasPending() {
        return this.queue.length > 0 || this.active;
    }
    getTotalMovedBytes() {
        return this.totalMovedBytes;
    }
    setTotalMovedBytes(bytes) {
        this.totalMovedBytes = bytes;
    }
}
// ─── ChunkManager ──────────────────────────────────────────────────────────────
class ChunkManager {
    opts;
    stateManager;
    state;
    fd = -1;
    aborted = false;
    activeCount = 0;
    pendingQueue = [];
    listeners = {};
    bytesPerSecond = 0;
    lastSpeedCheck = Date.now();
    bytesInWindow = 0;
    stateFlushTimer = null;
    pendingStateUpdates = [];
    pool;
    totalDownloaded = 0;
    // ── Turbo / promotion state ─────────────────────────────────────────────
    ioWriteQueue = null;
    turboHddSsd;
    promoting = false;
    turboPath = null;
    triggerTick = null; // re-trigger after promotion
    isWholeFileRequest(rangeStart, rangeEnd) {
        if (this.state.chunks.length !== 1)
            return false;
        if (rangeStart !== 0)
            return false;
        if (this.state.totalSize <= 0)
            return true;
        return rangeEnd === this.state.totalSize - 1;
    }
    constructor(state, stateManager, opts = {}) {
        this.state = state;
        this.stateManager = stateManager;
        const isHDD = opts.isHDD ?? false;
        this.opts = {
            maxConnections: opts.maxConnections ?? (isHDD ? 8 : 16),
            initialConnections: opts.initialConnections ?? 4,
            chunkSize: opts.chunkSize ?? DEFAULT_CHUNK_SIZE,
            retryLimit: opts.retryLimit ?? 3,
            retryDelay: opts.retryDelay ?? 2000,
            bandwidthLimitBps: opts.bandwidthLimitBps ?? 0,
            isHDD,
            turboConnectionsMultiplier: opts.turboConnectionsMultiplier ?? 1.0,
        };
        this.turboHddSsd = opts.turboHddSsd;
    }
    on(event, handler) {
        this.listeners[event] = handler;
        return this;
    }
    emit(event, ...args) {
        const h = this.listeners[event];
        if (h)
            h(...args);
    }
    // ─── Queue ───────────────────────────────────────────────────────────────────
    buildQueue() {
        this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c.downloaded, 0);
        this.pendingQueue = this.state.chunks.filter(c => !c.completed);
    }
    // ─── Main entry ─────────────────────────────────────────────────────────────
    async start(tmpFilePath) {
        this.aborted = false;
        this.buildQueue();
        const url = new url_1.URL(this.state.firmware.url);
        this.pool = makePool(url.origin, this.opts.maxConnections);
        // ── Dual-disk space check ──────────────────────────────────────────────
        // If turboHddSsd was set, verify both disks have space before allocating
        if (this.turboHddSsd) {
            const tmpDir = require("path").dirname(tmpFilePath);
            const hddDir = require("path").dirname(this.turboHddSsd.turboPath);
            try {
                // Check tmp disk (SSD)
                if (!fs.existsSync(tmpDir))
                    fs.mkdirSync(tmpDir, { recursive: true });
                const tmpStats = await fs.promises.statfs(tmpDir).catch(() => null);
                const tmpFree = tmpStats ? tmpStats.bavail * tmpStats.bsize : 0;
                const tmpNeeded = this.state.totalSize;
                // Check HDD disk
                if (!fs.existsSync(hddDir))
                    fs.mkdirSync(hddDir, { recursive: true });
                const hddStats = await fs.promises.statfs(hddDir).catch(() => null);
                const hddFree = hddStats ? hddStats.bavail * hddStats.bsize : 0;
                const hddNeeded = this.state.totalSize;
                if (tmpFree > 0 && tmpFree < tmpNeeded && hddFree >= hddNeeded) {
                    // SSD full, HDD OK → degrade to hdd_only
                    this.turboHddSsd = undefined;
                    this.turboPath = null;
                    this.emit("degraded");
                }
            }
            catch {
                // statfs not available on older Node — skip check, proceed optimistically
            }
        }
        // Open file for random-access write
        const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
        this.fd = fs.openSync(tmpFilePath, flags);
        // Pre-allocate to avoid fragmentation
        if (flags === "w" && this.state.totalSize > 0) {
            await this.fallocate(this.fd, this.state.totalSize);
        }
        // ── Set up turbo HDD+SSD progressive write ─────────────────────────────
        if (this.turboHddSsd) {
            this.turboPath = this.turboHddSsd.turboPath;
            // Create and pre-allocate .turbo file
            if (!fs.existsSync(this.turboPath)) {
                const turboFd = fs.openSync(this.turboPath, "w");
                if (this.state.totalSize > 0) {
                    await this.fallocate(turboFd, this.state.totalSize);
                }
                fs.closeSync(turboFd);
            }
            // Start IOWriteQueue
            this.ioWriteQueue = new IOWriteQueue(tmpFilePath, this.turboPath, this.stateManager, this.state.id, this.state.totalSize, (info) => {
                this.emit("turboMove", info);
                if (this.turboHddSsd?.onTurboMove)
                    this.turboHddSsd.onTurboMove(info);
            }, (err) => {
                this.emit("turboHddError", err);
                if (this.turboHddSsd?.onTurboHddError)
                    this.turboHddSsd.onTurboHddError(err);
            });
            // Recover: enqueue completed-but-not-moved chunks, set total moved bytes
            const movedSet = new Set(this.state.movedChunks ?? []);
            let preMovedBytes = 0;
            for (const chunk of this.state.chunks) {
                if (movedSet.has(chunk.index)) {
                    preMovedBytes += chunk.completed
                        ? (chunk.end - chunk.start + 1)
                        : chunk.downloaded;
                    continue;
                }
                if (chunk.completed) {
                    // Chunk was downloaded but never moved — enqueue for background move
                    this.ioWriteQueue.enqueue({
                        chunkIndex: chunk.index,
                        start: chunk.start,
                        end: chunk.end,
                        size: chunk.end - chunk.start + 1,
                    });
                }
            }
            if (preMovedBytes > 0) {
                this.ioWriteQueue.setTotalMovedBytes(preMovedBytes);
            }
        }
        try {
            await new Promise((resolve, reject) => {
                const tick = () => {
                    if (this.aborted) {
                        if (this.activeCount === 0) {
                            // All in-flight chunks finished — cleanly reject
                            reject(new Error("Aborted"));
                        }
                        return;
                    }
                    // Don't start new downloads while promoting
                    if (this.promoting) {
                        if (this.activeCount === 0 && this.pendingQueue.length === 0) {
                            // Wait — promotion will call tick() again
                            return;
                        }
                    }
                    while (this.activeCount < this.currentMaxConnections() &&
                        this.pendingQueue.length > 0 &&
                        !this.promoting) {
                        const chunk = this.pendingQueue.shift();
                        this.activeCount++;
                        this.downloadChunk(chunk, 0)
                            .then(() => { this.activeCount--; tick(); })
                            .catch(err => { this.activeCount--; this.emit("error", err); reject(err); });
                    }
                    if (this.activeCount === 0 && this.pendingQueue.length === 0) {
                        this.flushStateNow();
                        fs.closeSync(this.fd);
                        this.fd = -1;
                        this.triggerTick = null;
                        this.emit("complete");
                        resolve();
                    }
                };
                this.triggerTick = tick;
                tick();
            });
        }
        finally {
            await this.pool.destroy().catch(() => { });
        }
    }
    // ─── Adaptive concurrency ───────────────────────────────────────────────────
    currentMaxConnections() {
        const elapsed = (Date.now() - this.lastSpeedCheck) / 1000;
        const rampFactor = Math.min(1, elapsed / 10);
        const target = Math.round(this.opts.initialConnections +
            (this.opts.maxConnections - this.opts.initialConnections) * rampFactor);
        return Math.max(this.opts.initialConnections, target);
    }
    // ─── Chunk download with retry ──────────────────────────────────────────────
    async downloadChunk(chunk, attempt) {
        if (this.aborted)
            return;
        const start = chunk.start + chunk.downloaded;
        const end = chunk.end;
        if (start > end) {
            chunk.completed = true;
            this.queueStateUpdate(chunk.index, chunk.downloaded, true);
            this.emit("chunkComplete", chunk.index);
            // Enqueue for HDD write if turboHddSsd is active
            if (this.ioWriteQueue && !this.ioWriteQueue["stopped"]) {
                this.ioWriteQueue.enqueue({
                    chunkIndex: chunk.index,
                    start: chunk.start,
                    end: chunk.end,
                    size: chunk.end - chunk.start + 1,
                });
            }
            return;
        }
        try {
            await this.fetchRange(chunk, start, end);
        }
        catch (err) {
            this.emit("chunkError", chunk.index, err, attempt);
            if (attempt < this.opts.retryLimit && !this.aborted) {
                await this.sleep(this.opts.retryDelay * (attempt + 1));
                return this.downloadChunk(chunk, attempt + 1);
            }
            throw new Error(`Chunk ${chunk.index} failed after ${attempt + 1} attempts: ${err.message}`);
        }
    }
    async fetchRange(chunk, rangeStart, rangeEnd) {
        if (this.aborted)
            throw new Error("Aborted");
        const url = new url_1.URL(this.state.firmware.url);
        const path = url.pathname + url.search;
        let response;
        try {
            response = await this.pool.request({
                origin: url.origin,
                path,
                method: "GET",
                headers: {
                    "range": `bytes=${rangeStart}-${rangeEnd}`,
                    "user-agent": "iTunes/12.12.10",
                    "connection": "keep-alive",
                    "accept-encoding": "identity",
                },
                headersTimeout: 15_000,
                bodyTimeout: 120_000
            });
        }
        catch (err) {
            if (this.aborted)
                throw new Error("Aborted");
            throw err;
        }
        const allowWholeFile200 = this.isWholeFileRequest(rangeStart, rangeEnd);
        if (response.statusCode === 200 && !allowWholeFile200) {
            await response.body.dump();
            throw new Error(`Server ignored range request for chunk ${chunk.index}`);
        }
        if (response.statusCode !== 206 && response.statusCode !== 200) {
            await response.body.dump();
            throw new Error(`HTTP ${response.statusCode} for chunk ${chunk.index}`);
        }
        // ── Stream body → disk ────────────────────────────────────────────────────
        let writeHead = rangeStart;
        const buffers = [];
        let bufferedBytes = 0;
        const flushBuffers = async () => {
            if (buffers.length === 0)
                return;
            if (this.aborted || this.fd === -1) {
                buffers.length = 0;
                bufferedBytes = 0;
                return;
            }
            const combined = Buffer.concat(buffers);
            buffers.length = 0;
            bufferedBytes = 0;
            await new Promise((res, rej) => fs.write(this.fd, combined, 0, combined.length, writeHead, (e) => (e ? rej(e) : res())));
            writeHead += combined.length;
            chunk.downloaded = writeHead - chunk.start;
            this.totalDownloaded += combined.length;
            this.bytesInWindow += combined.length;
            this.updateSpeed();
            this.queueStateUpdate(chunk.index, chunk.downloaded, false);
            this.emit("progress", {
                chunkIndex: chunk.index,
                bytesWritten: this.totalDownloaded,
                totalBytes: this.state.totalSize,
            });
            if (this.opts.bandwidthLimitBps > 0) {
                const throttleMs = (combined.length / this.opts.bandwidthLimitBps) * 1000;
                if (throttleMs > 5)
                    await this.sleep(throttleMs);
            }
        };
        for await (const data of response.body) {
            if (this.aborted) {
                await response.body.dump().catch(() => { });
                throw new Error("Aborted");
            }
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            buffers.push(buf);
            bufferedBytes += buf.length;
            if (bufferedBytes >= WRITE_HIGH_WATER) {
                await flushBuffers();
            }
        }
        await flushBuffers();
        chunk.completed = true;
        this.queueStateUpdate(chunk.index, chunk.downloaded, true);
        this.emit("chunkComplete", chunk.index);
        // ── Enqueue for HDD write (turbo HDD+SSD progressive move) ──────────
        if (this.ioWriteQueue && !this.ioWriteQueue["stopped"]) {
            this.ioWriteQueue.enqueue({
                chunkIndex: chunk.index,
                start: chunk.start,
                end: chunk.end,
                size: chunk.end - chunk.start + 1,
            });
        }
    }
    // ─── HEAD request via undici ────────────────────────────────────────────────
    static async fetchMetadata(url) {
        const parsed = new url_1.URL(url);
        const pool = new undici_1.Pool(parsed.origin, { connections: 1, headersTimeout: 15_000 });
        try {
            const res = await pool.request({
                origin: parsed.origin,
                path: parsed.pathname + parsed.search,
                method: "HEAD",
                headers: { "user-agent": "iTunes/12.12.10" },
            });
            await res.body.dump();
            const contentLength = parseInt(res.headers["content-length"] || "0");
            const acceptsRanges = res.headers["accept-ranges"] === "bytes";
            return { contentLength, acceptsRanges };
        }
        finally {
            await pool.destroy().catch(() => { });
        }
    }
    // ─── Promotion ──────────────────────────────────────────────────────────────
    /**
     * Promote a normal download to turbo. Creates the IOWriteQueue and enqueues
     * already-completed chunks so they're moved tmp → .turbo in the background.
     * Partially-downloaded chunks stay on tmp and will be enqueued when they
     * complete. The download fd stays on SSD tmp — the download never touches HDD.
     */
    async promote(tmpPath, turboPath) {
        this.promoting = true;
        // Wait for in-flight chunk downloads to finish
        while (this.activeCount > 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        // Stop existing IOWriteQueue if any
        if (this.ioWriteQueue) {
            await this.ioWriteQueue.stop();
            this.ioWriteQueue = null;
        }
        // Ensure .turbo exists and is pre-allocated
        if (!fs.existsSync(turboPath)) {
            const turboFd = fs.openSync(turboPath, "w");
            if (this.state.totalSize > 0) {
                await this.fallocate(turboFd, this.state.totalSize);
            }
            fs.closeSync(turboFd);
        }
        this.turboPath = turboPath;
        // Create IOWriteQueue first, then enqueue completed chunks into it
        // (non-blocking — they move in the background while download continues)
        this.ioWriteQueue = new IOWriteQueue(tmpPath, turboPath, this.stateManager, this.state.id, this.state.totalSize, (info) => { this.emit("turboMove", info); }, (err) => { this.emit("turboHddError", err); });
        // Load fresh state to see which chunks were already moved
        const freshState = this.stateManager.load(this.state.id);
        const alreadyMoved = new Set(freshState?.movedChunks ?? []);
        let preMovedBytes = 0;
        for (const chunk of this.state.chunks) {
            if (alreadyMoved.has(chunk.index)) {
                preMovedBytes += chunk.completed
                    ? (chunk.end - chunk.start + 1)
                    : chunk.downloaded;
                continue;
            }
            if (chunk.completed) {
                // Enqueue completed chunk for background move tmp → .turbo
                this.ioWriteQueue.enqueue({
                    chunkIndex: chunk.index,
                    start: chunk.start,
                    end: chunk.end,
                    size: chunk.end - chunk.start + 1,
                });
            }
        }
        if (preMovedBytes > 0) {
            this.ioWriteQueue.setTotalMovedBytes(preMovedBytes);
        }
        // Rebuild pending queue for the download loop
        this.pendingQueue = this.state.chunks.filter(c => !c.completed);
        this.promoting = false;
        // Re-trigger the download loop
        this.triggerTick?.();
    }
    // ─── Turbo helpers ──────────────────────────────────────────────────────────
    updateMaxConnections(newMax) {
        this.opts.maxConnections = newMax;
    }
    getTotalMovedBytes() {
        return this.ioWriteQueue?.getTotalMovedBytes() ?? 0;
    }
    /** Drain every queued chunk → .turbo, then stop. Used at download completion. */
    async drainIOWorker() {
        if (this.ioWriteQueue) {
            await this.ioWriteQueue.drain();
            this.ioWriteQueue = null;
        }
    }
    /** Abort the IOWorker — finish the in-flight chunk, discard remaining queue. */
    async stopIOWorker() {
        if (this.ioWriteQueue) {
            await this.ioWriteQueue.stop();
            this.ioWriteQueue = null;
        }
    }
    cleanupTurboFile() {
        if (this.turboPath && fs.existsSync(this.turboPath)) {
            try {
                fs.unlinkSync(this.turboPath);
            }
            catch { }
        }
    }
    isTurboHddSsd() {
        return this.turboPath !== null;
    }
    getTurboPath() {
        return this.turboPath;
    }
    // ─── Helpers ────────────────────────────────────────────────────────────────
    fallocate(fd, size) {
        return new Promise((resolve, reject) => {
            fs.ftruncate(fd, size, err => (err ? reject(err) : resolve()));
        });
    }
    updateSpeed() {
        const now = Date.now();
        const elapsed = (now - this.lastSpeedCheck) / 1000;
        if (elapsed >= 1) {
            this.bytesPerSecond = Math.round(this.bytesInWindow / elapsed);
            this.bytesInWindow = 0;
            this.lastSpeedCheck = now;
        }
    }
    getSpeed() { return this.bytesPerSecond; }
    abort() {
        this.aborted = true;
        // Stop IOWriteQueue gracefully
        if (this.ioWriteQueue) {
            this.ioWriteQueue.stop().catch(() => { });
        }
        if (this.fd !== -1) {
            try {
                fs.closeSync(this.fd);
            }
            catch { }
            this.fd = -1;
        }
        this.flushStateNow();
    }
    queueStateUpdate(index, downloaded, completed) {
        const existing = this.pendingStateUpdates.find(u => u.index === index);
        if (existing) {
            existing.downloaded = downloaded;
            existing.completed = completed;
        }
        else
            this.pendingStateUpdates.push({ index, downloaded, completed });
        if (!this.stateFlushTimer) {
            this.stateFlushTimer = setTimeout(() => this.flushStateNow(), 2000);
        }
    }
    flushStateNow() {
        if (this.stateFlushTimer) {
            clearTimeout(this.stateFlushTimer);
            this.stateFlushTimer = null;
        }
        if (this.pendingStateUpdates.length > 0) {
            this.stateManager.batchUpdateChunks(this.state.id, this.pendingStateUpdates);
            this.pendingStateUpdates = [];
        }
    }
    sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }
}
exports.ChunkManager = ChunkManager;
