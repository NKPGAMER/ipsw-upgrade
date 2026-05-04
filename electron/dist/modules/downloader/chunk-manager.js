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
const WRITE_HIGH_WATER = 8 * 1024 * 1024; // 8 MB — flush threshold (larger = fewer syscalls)
/** undici Pool options tuned for bulk file transfer */
function makePool(origin, maxConnections) {
    return new undici_1.Pool(origin, {
        connections: maxConnections,
        pipelining: 1, // HTTP/1.1 keep-alive; 1 avoids HOL blocking on range requests
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connect: {
            rejectUnauthorized: false, // Apple CDN uses valid certs — set true in prod if preferred
            timeout: 15_000,
        },
        bodyTimeout: 60_000,
        headersTimeout: 15_000,
    });
}
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
        };
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
        // Open file for random-access write
        const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
        this.fd = fs.openSync(tmpFilePath, flags);
        // Pre-allocate to avoid fragmentation (especially on HDD)
        if (flags === "w" && this.state.totalSize > 0) {
            await this.fallocate(this.fd, this.state.totalSize);
        }
        try {
            await new Promise((resolve, reject) => {
                const tick = () => {
                    if (this.aborted)
                        return;
                    while (this.activeCount < this.currentMaxConnections() &&
                        this.pendingQueue.length > 0) {
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
                        this.emit("complete");
                        resolve();
                    }
                };
                tick();
            });
        }
        finally {
            // Always destroy the pool when done or aborted
            await this.pool.destroy().catch(() => { });
        }
    }
    // ─── Adaptive concurrency ────────────────────────────────────────────────────
    currentMaxConnections() {
        const elapsed = (Date.now() - this.lastSpeedCheck) / 1000;
        const rampFactor = Math.min(1, elapsed / 10);
        const target = Math.round(this.opts.initialConnections +
            (this.opts.maxConnections - this.opts.initialConnections) * rampFactor);
        return Math.max(this.opts.initialConnections, target);
    }
    // ─── Chunk download with retry ───────────────────────────────────────────────
    async downloadChunk(chunk, attempt) {
        if (this.aborted)
            return;
        const start = chunk.start + chunk.downloaded;
        const end = chunk.end;
        if (start > end) {
            chunk.completed = true;
            this.queueStateUpdate(chunk.index, chunk.downloaded, true);
            this.emit("chunkComplete", chunk.index);
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
    /**
     * Fetch byte range via undici Pool, write with async fs.write (non-blocking I/O).
     * Uses async-iterator on the response body for built-in back-pressure.
     */
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
                    "accept-encoding": "identity", // Disable compression — we need exact byte ranges
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
        /**
         * Async write — avoids blocking the event loop unlike writeSync.
         * Returns a promise so we can await it before advancing writeHead.
         */
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
            // Bandwidth throttle (optional)
            if (this.opts.bandwidthLimitBps > 0) {
                const throttleMs = (combined.length / this.opts.bandwidthLimitBps) * 1000;
                if (throttleMs > 5)
                    await this.sleep(throttleMs);
            }
        };
        // undici body is a web ReadableStream / AsyncIterable<Buffer>
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
        // Flush remainder
        await flushBuffers();
        chunk.completed = true;
        this.queueStateUpdate(chunk.index, chunk.downloaded, true);
        this.emit("chunkComplete", chunk.index);
    }
    // ─── HEAD request via undici ─────────────────────────────────────────────────
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
    // ─── Helpers ─────────────────────────────────────────────────────────────────
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
        if (this.fd !== -1) {
            try {
                fs.closeSync(this.fd);
            }
            catch { }
            this.fd = -1;
        }
        this.flushStateNow();
        // pool.destroy() is called in start()'s finally block
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
