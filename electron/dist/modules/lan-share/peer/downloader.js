"use strict";
/**
 * peer/downloader.ts
 *
 * Multi-source chunked downloader.
 *
 * Given a file and a list of peer candidates, it:
 *  1. Probes each candidate with GET /can-serve
 *  2. Builds a chunk plan (distributes byte ranges across peers)
 *  3. Downloads all chunks in parallel using streaming HTTP
 *  4. Writes directly to the output file at correct offsets (no buffering)
 *  5. Retries failed chunks on alternate peers
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
exports.PeerDownloader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const url_1 = require("url");
const utils_1 = require("../shared/utils");
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB
const DEFAULT_CONCURRENCY = 6;
const WRITE_BUFFER_SIZE = 512 * 1024; // 512 KB write buffer per chunk
// ─── Downloader ───────────────────────────────────────────────────────────────
class PeerDownloader {
    node;
    downloadState;
    constructor(node) {
        this.node = node;
    }
    /**
     * Full download flow:
     * 1. Query coordinator for peers with this file
     * 2. Probe peers for capacity
     * 3. Build chunk plan
     * 4. Download in parallel
     */
    async download(opts) {
        this.node?.incrementDownloads();
        try {
            // Step 1: Query coordinator
            const locations = await this.queryCoordinator(opts.coordinatorUrl, opts.fileId);
            if (locations.length === 0)
                throw new Error("No peers have this file");
            // Step 2: Probe peers and get live capacity
            const probed = await this.probePeers(locations);
            if (probed.length === 0)
                throw new Error("All peers are busy or unreachable");
            console.log(`[Downloader] ${probed.length} peers available for ${opts.fileName}`);
            // Step 3: Build chunk plan
            const chunks = (0, utils_1.buildChunkPlan)(opts.fileSize, probed, opts.chunkSize ?? DEFAULT_CHUNK_SIZE);
            console.log(`[Downloader] ${chunks.length} chunks across ${probed.length} peers`);
            // Step 4: Allocate output file
            await this.allocateFile(opts.outputPath, opts.fileSize);
            // Step 4b: Initialize DownloadState for resume compatibility
            if (opts.stateManager && opts.downloadId) {
                let state = opts.stateManager.load(opts.downloadId);
                if (!state) {
                    // No pre-existing state — build one (firmware is placeholder; caller should pre-save)
                    const chunkStates = chunks.map(c => ({
                        index: c.index,
                        start: c.rangeStart,
                        end: c.rangeEnd,
                        downloaded: 0,
                        completed: false,
                    }));
                    state = {
                        id: opts.downloadId,
                        firmware: {},
                        savePath: path.dirname(opts.outputPath),
                        tmpPath: opts.outputPath,
                        totalSize: opts.fileSize,
                        chunks: chunkStates,
                        supportsRanges: true,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };
                    opts.stateManager.save(state);
                }
                this.downloadState = state;
            }
            // Step 5: Download
            await this.downloadChunks(chunks, opts, probed);
        }
        finally {
            this.node?.decrementDownloads();
        }
    }
    // ─── Coordinator query ─────────────────────────────────────────────────────
    async queryCoordinator(coordinatorUrl, fileId) {
        const res = await fetch(`${coordinatorUrl}/files/${fileId}`);
        if (res.status === 404)
            return [];
        if (!res.ok)
            throw new Error(`Coordinator error: HTTP ${res.status}`);
        const data = await res.json();
        return data.locations ?? [];
    }
    // ─── Peer probing ──────────────────────────────────────────────────────────
    async probePeers(locations) {
        const results = await Promise.allSettled(locations.map(loc => this.probePeer(loc)));
        const available = [];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "fulfilled" && r.value) {
                available.push(locations[i]);
            }
        }
        return (0, utils_1.rankCandidates)(available);
    }
    async probePeer(loc) {
        try {
            const res = await fetch(`http://${loc.ip}:${loc.port}/can-serve`, {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok)
                return false;
            const data = await res.json();
            return data.status === "ACCEPT";
        }
        catch {
            return false;
        }
    }
    // ─── File allocation ───────────────────────────────────────────────────────
    async allocateFile(outputPath, size) {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        // Pre-allocate with ftruncate to avoid fragmentation
        const fd = fs.openSync(outputPath, "w");
        try {
            await new Promise((res, rej) => fs.ftruncate(fd, size, e => (e ? rej(e) : res())));
        }
        finally {
            fs.closeSync(fd);
        }
    }
    // ─── Parallel chunk download ───────────────────────────────────────────────
    async downloadChunks(chunks, opts, allPeers) {
        const concurrency = opts.maxConcurrentChunks ?? DEFAULT_CONCURRENCY;
        const totalBytes = opts.fileSize;
        let downloadedBytes = 0;
        let activeChunks = 0;
        const startedAt = Date.now();
        let lastStateFlushAt = Date.now();
        const STATE_FLUSH_INTERVAL_MS = 2000;
        // Open file for random-access write
        const fd = fs.openSync(opts.outputPath, "r+");
        const flushState = () => {
            if (!opts.stateManager || !opts.downloadId || !this.downloadState)
                return;
            const now = Date.now();
            if (now - lastStateFlushAt < STATE_FLUSH_INTERVAL_MS)
                return;
            lastStateFlushAt = now;
            const updates = this.downloadState.chunks
                .filter(c => !c.completed)
                .map(c => ({ index: c.index, downloaded: c.downloaded, completed: c.completed }));
            if (updates.length > 0) {
                opts.stateManager.batchUpdateChunks(opts.downloadId, updates);
            }
        };
        try {
            await new Promise((resolve, reject) => {
                const queue = [...chunks];
                let inFlight = 0;
                let failed = 0;
                const dispatch = () => {
                    while (inFlight < concurrency && queue.length > 0) {
                        const chunk = queue.shift();
                        inFlight++;
                        activeChunks++;
                        this.downloadChunk(chunk, opts.fileId, fd, allPeers, opts)
                            .then(bytes => {
                            downloadedBytes += bytes;
                            inFlight--;
                            activeChunks--;
                            flushState();
                            // Progress callback
                            if (opts.onProgress) {
                                const elapsedSec = (Date.now() - startedAt) / 1000;
                                const speed = downloadedBytes / Math.max(elapsedSec, 0.001);
                                const remaining = totalBytes - downloadedBytes;
                                opts.onProgress({
                                    downloaded: downloadedBytes,
                                    total: totalBytes,
                                    pct: Math.round((downloadedBytes / totalBytes) * 100),
                                    speed,
                                    eta: speed > 0 ? Math.round(remaining / speed) : undefined,
                                    activeChunks,
                                    chunkIndex: chunk.index,
                                });
                            }
                            if (inFlight === 0 && queue.length === 0)
                                resolve();
                            else
                                dispatch();
                        })
                            .catch(err => {
                            inFlight--;
                            activeChunks--;
                            failed++;
                            console.error(`[Downloader] Chunk failed: ${err.message}`);
                            reject(err);
                        });
                    }
                };
                dispatch();
                if (chunks.length === 0)
                    resolve();
            });
        }
        finally {
            // Final state flush
            if (opts.stateManager && opts.downloadId && this.downloadState) {
                const updates = this.downloadState.chunks.map(c => ({
                    index: c.index, downloaded: c.downloaded, completed: c.completed
                }));
                opts.stateManager.batchUpdateChunks(opts.downloadId, updates);
            }
            fs.closeSync(fd);
        }
    }
    // ─── Single chunk download ─────────────────────────────────────────────────
    async downloadChunk(chunk, fileId, fd, fallbacks, opts, attempt = 0) {
        const url = `http://${chunk.ip}:${chunk.port}/file/${fileId}`;
        const rangeHeader = `bytes=${chunk.rangeStart}-${chunk.rangeEnd}`;
        const expectedBytes = chunk.rangeEnd - chunk.rangeStart + 1;
        try {
            const bytesWritten = await this.streamChunkToFile(url, rangeHeader, fd, chunk.rangeStart, (bytesSoFar) => {
                if (opts.stateManager && opts.downloadId && this.downloadState) {
                    const cs = this.downloadState.chunks[chunk.index];
                    if (cs)
                        cs.downloaded = bytesSoFar;
                }
            });
            if (bytesWritten !== expectedBytes) {
                throw new Error(`Expected ${expectedBytes} bytes, got ${bytesWritten}`);
            }
            // Mark chunk completed in state
            if (opts.stateManager && opts.downloadId && this.downloadState) {
                const cs = this.downloadState.chunks[chunk.index];
                if (cs) {
                    cs.downloaded = expectedBytes;
                    cs.completed = true;
                }
                opts.stateManager.updateChunk(opts.downloadId, chunk.index, expectedBytes, true);
            }
            return bytesWritten;
        }
        catch (err) {
            if (attempt < 2) {
                // Try a different peer for this chunk
                const alt = fallbacks.find(p => !(p.ip === chunk.ip && p.port === chunk.port));
                if (alt) {
                    console.warn(`[Downloader] Retrying chunk on ${alt.ip}:${alt.port}`);
                    return this.downloadChunk({ ...chunk, ip: alt.ip, port: alt.port, nodeId: alt.nodeId }, fileId, fd, fallbacks, opts, attempt + 1);
                }
            }
            throw new Error(`Chunk ${chunk.rangeStart}-${chunk.rangeEnd} failed: ${err.message}`);
        }
    }
    streamChunkToFile(url, rangeHeader, fd, writeOffset, onProgress) {
        return new Promise((resolve, reject) => {
            const parsed = new url_1.URL(url);
            const options = {
                hostname: parsed.hostname,
                port: parseInt(parsed.port),
                path: parsed.pathname,
                method: "GET",
                headers: {
                    range: rangeHeader,
                    "user-agent": "lan-share/1.0",
                    "accept-encoding": "identity",
                },
            };
            const req = http.request(options, res => {
                if (res.statusCode === 503) {
                    res.resume();
                    reject(new Error("Peer returned BUSY"));
                    return;
                }
                if (res.statusCode !== 206 && res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                let position = writeOffset;
                let totalWritten = 0;
                const buffers = [];
                let bufferedBytes = 0;
                const flushToFile = (final = false) => {
                    if (buffers.length === 0)
                        return Promise.resolve();
                    const combined = Buffer.concat(buffers);
                    buffers.length = 0;
                    bufferedBytes = 0;
                    return new Promise((res2, rej2) => {
                        fs.write(fd, combined, 0, combined.length, position, (err, written) => {
                            if (err) {
                                rej2(err);
                                return;
                            }
                            position += written;
                            totalWritten += written;
                            if (onProgress)
                                onProgress(totalWritten);
                            res2();
                        });
                    });
                };
                const processChunk = async (chunk) => {
                    buffers.push(chunk);
                    bufferedBytes += chunk.length;
                    if (bufferedBytes >= WRITE_BUFFER_SIZE) {
                        await flushToFile();
                    }
                };
                res.on("data", (chunk) => {
                    res.pause();
                    processChunk(chunk).then(() => res.resume()).catch(reject);
                });
                res.on("end", () => {
                    flushToFile(true).then(() => resolve(totalWritten)).catch(reject);
                });
                res.on("error", reject);
            });
            req.on("error", reject);
            req.setTimeout(60_000, () => {
                req.destroy(new Error("Request timeout"));
            });
            req.end();
        });
    }
}
exports.PeerDownloader = PeerDownloader;
