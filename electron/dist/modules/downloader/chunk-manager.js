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
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB per chunk
const WRITE_HIGH_WATER = 4 * 1024 * 1024; // 4MB write buffer
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
    totalDownloaded = 0; // live bytes downloaded in this session
    /**
     * Build chunk plan from state (supports resume) — use direct references, NOT clones
     */
    buildQueue() {
        // Seed totalDownloaded from already-completed chunks (resume case)
        this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c.downloaded, 0);
        this.pendingQueue = this.state.chunks
            .filter(c => !c.completed);
        // NOTE: no .map(c => ({...c})) — we want direct references so state.chunks stays in sync
    }
    /**
     * Main entry — start downloading all pending chunks
     */
    async start(tmpFilePath) {
        this.aborted = false;
        this.buildQueue();
        // Open file for random-access write
        const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
        this.fd = fs.openSync(tmpFilePath, flags);
        // Pre-allocate file size (avoids fragmentation on HDD)
        if (flags === "w" && this.state.totalSize > 0) {
            await this.fallocate(this.fd, this.state.totalSize);
        }
        // Start chunk draining loop
        await new Promise((resolve, reject) => {
            const tick = () => {
                if (this.aborted)
                    return;
                while (this.activeCount < this.currentMaxConnections() && this.pendingQueue.length > 0) {
                    const chunk = this.pendingQueue.shift();
                    this.activeCount++;
                    this.downloadChunk(chunk, 0)
                        .then(() => {
                        this.activeCount--;
                        tick();
                    })
                        .catch(err => {
                        this.activeCount--;
                        this.emit("error", err);
                        reject(err);
                    });
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
    /**
     * Adaptive connection count — scale from initial → max
     */
    currentMaxConnections() {
        const elapsed = (Date.now() - this.lastSpeedCheck) / 1000;
        // Ramp up over first 10 seconds
        const rampFactor = Math.min(1, elapsed / 10);
        const target = Math.round(this.opts.initialConnections +
            (this.opts.maxConnections - this.opts.initialConnections) * rampFactor);
        return Math.max(this.opts.initialConnections, target);
    }
    /**
     * Download a single chunk with retry
     */
    async downloadChunk(chunk, attempt) {
        if (this.aborted)
            return;
        const start = chunk.start + chunk.downloaded;
        const end = chunk.end;
        if (start > end) {
            // Already done
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
     * Fetch a byte range via HTTP(S), write via random-access fs.writeSync (guaranteed order)
     */
    fetchRange(chunk, rangeStart, rangeEnd) {
        return new Promise((resolve, reject) => {
            if (this.aborted)
                return reject(new Error("Aborted"));
            const url = new url_1.URL(this.state.firmware.url);
            const lib = url.protocol === "https:" ? https : http;
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === "https:" ? 443 : 80),
                path: url.pathname + url.search,
                method: "GET",
                headers: {
                    "Range": `bytes=${rangeStart}-${rangeEnd}`,
                    "User-Agent": "iLog-Downloader/1.0",
                    "Connection": "keep-alive",
                },
                timeout: 30000,
            };
            const req = lib.request(options, (res) => {
                if (this.aborted) {
                    res.destroy();
                    return reject(new Error("Aborted"));
                }
                if (res.statusCode !== 206 && res.statusCode !== 200) {
                    res.destroy();
                    return reject(new Error(`HTTP ${res.statusCode} for chunk ${chunk.index}`));
                }
                // writeHead tracks the exact file position for the next write
                let writeHead = rangeStart;
                const buffers = [];
                let bufferedBytes = 0;
                let settled = false;
                const abortCheck = setInterval(() => {
                    if (this.aborted) {
                        clearInterval(abortCheck);
                        if (!settled) {
                            settled = true;
                            res.destroy();
                            reject(new Error("Aborted"));
                        }
                    }
                }, 50);
                /**
                 * Flush accumulated buffers to disk at the correct file offset.
                 * Uses fs.writeSync so order is guaranteed — no async race on writeHead.
                 */
                const flushBuffers = () => {
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
                    // Synchronous write — guarantees writeHead is correct before next flush
                    try {
                        fs.writeSync(this.fd, combined, 0, combined.length, writeHead);
                    }
                    catch (err) {
                        if (!this.aborted)
                            reject(err);
                        return;
                    }
                    writeHead += combined.length; // advance only AFTER successful write
                    chunk.downloaded = writeHead - chunk.start; // absolute progress for this chunk
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
                        const expectedMs = (combined.length / this.opts.bandwidthLimitBps) * 1000;
                        if (expectedMs > 5)
                            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, expectedMs);
                    }
                };
                res.on("data", (data) => {
                    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                    buffers.push(buf);
                    bufferedBytes += buf.length;
                    if (bufferedBytes >= WRITE_HIGH_WATER) {
                        flushBuffers();
                    }
                });
                res.on("end", () => {
                    clearInterval(abortCheck);
                    if (settled)
                        return;
                    settled = true;
                    flushBuffers(); // flush tail
                    chunk.completed = true;
                    this.queueStateUpdate(chunk.index, chunk.downloaded, true);
                    this.emit("chunkComplete", chunk.index);
                    resolve();
                });
                res.on("error", (err) => {
                    clearInterval(abortCheck);
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                });
            });
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error(`Timeout on chunk ${chunk.index}`));
            });
            req.end();
        });
    }
    /**
     * Pre-allocate file size using ftruncate — safe, no data corruption
     */
    fallocate(fd, size) {
        return new Promise((resolve, reject) => {
            fs.ftruncate(fd, size, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
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
    getSpeed() {
        return this.bytesPerSecond;
    }
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
    }
    queueStateUpdate(index, downloaded, completed) {
        const existing = this.pendingStateUpdates.find(u => u.index === index);
        if (existing) {
            existing.downloaded = downloaded;
            existing.completed = completed;
        }
        else {
            this.pendingStateUpdates.push({ index, downloaded, completed });
        }
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
