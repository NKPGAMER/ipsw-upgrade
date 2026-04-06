"use strict";
/**
 * PipelineManager — streams completed download data from SSD tmp → HDD dest
 * while the download is still in progress.
 *
 * Strategy:
 * - Watches how many bytes have been written to the SSD tmp file
 * - When a contiguous "head" of completed bytes exceeds the flush threshold,
 *   spawns a Worker to copy that segment to the HDD destination
 * - Next flush starts where the last one ended
 * - After download completes, flushes the remaining tail
 *
 * Result: HDD write happens in parallel with SSD download — no idle time.
 * The final file on HDD is assembled in order, without gaps.
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
exports.PipelineManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const worker_threads_1 = require("worker_threads");
class PipelineManager {
    opts;
    flushThreshold;
    flushedUpTo = 0; // how many bytes have been flushed to HDD
    flushInProgress = false;
    stopped = false;
    constructor(opts) {
        this.opts = opts;
        this.flushThreshold = opts.flushThreshold ?? 512 * 1024 * 1024; // 512MB
    }
    /**
     * Called by ChunkManager whenever chunks complete.
     * chunks = full chunk list from DownloadState (direct references).
     * Returns how many bytes are contiguously complete from byte 0.
     */
    notifyProgress(chunks) {
        if (this.stopped || this.flushInProgress)
            return;
        const contiguousHead = this.getContiguousHead(chunks);
        const available = contiguousHead - this.flushedUpTo;
        if (available >= this.flushThreshold) {
            this.flush(contiguousHead);
        }
    }
    /**
     * Call after download finishes — flushes any remaining bytes.
     */
    async flushRemaining(chunks, onProgress) {
        if (this.stopped)
            return;
        // Wait for any in-progress flush to finish
        while (this.flushInProgress) {
            await new Promise(r => setTimeout(r, 100));
        }
        const contiguousHead = this.getContiguousHead(chunks);
        if (contiguousHead > this.flushedUpTo) {
            await this.flushAsync(contiguousHead, onProgress);
        }
        else if (onProgress) {
            onProgress(this.flushedUpTo);
        }
    }
    stop() {
        this.stopped = true;
    }
    getBytesMovedToHDD() {
        return this.flushedUpTo;
    }
    // ── Private ──────────────────────────────────────────────────────────────────
    /**
     * Returns the byte offset up to which all data is contiguously complete.
     * E.g. if chunks 0,1,2 are done but 3 is partial, returns end of chunk 2 + 1.
     */
    getContiguousHead(chunks) {
        // Chunks are ordered by start offset
        const sorted = [...chunks].sort((a, b) => a.start - b.start);
        let head = 0;
        for (const c of sorted) {
            if (c.start > head)
                break; // gap — stop
            if (c.completed) {
                head = c.end + 1;
            }
            else {
                // Partial chunk — only completed data up to start + downloaded is safe
                // but we can't guarantee it's written sequentially within the chunk.
                // Conservative: only count fully completed chunks.
                break;
            }
        }
        return head;
    }
    flush(upTo) {
        this.flushInProgress = true;
        const srcOffset = this.flushedUpTo;
        const length = upTo - srcOffset;
        this.runCopyWorker(srcOffset, length)
            .then(() => {
            this.flushedUpTo = upTo;
            this.flushInProgress = false;
            if (this.opts.onFlushed)
                this.opts.onFlushed(this.flushedUpTo);
        })
            .catch(() => {
            // Non-fatal: will retry on next notifyProgress or flushRemaining
            this.flushInProgress = false;
        });
    }
    flushAsync(upTo, onProgress) {
        const srcOffset = this.flushedUpTo;
        const length = upTo - srcOffset;
        return this.runCopyWorker(srcOffset, length, (bytesInSegment) => {
            const total = this.flushedUpTo + bytesInSegment;
            if (onProgress)
                onProgress(total);
            if (this.opts.onFlushed)
                this.opts.onFlushed(total);
        }).then(() => {
            this.flushedUpTo = upTo;
            if (this.opts.onFlushed)
                this.opts.onFlushed(this.flushedUpTo);
            if (onProgress)
                onProgress(this.flushedUpTo);
        });
    }
    runCopyWorker(srcOffset, length, onProgress) {
        return new Promise((resolve, reject) => {
            // Pre-allocate dest file on first flush
            if (srcOffset === 0 && this.opts.totalSize > 0 && !fs.existsSync(this.opts.destPath)) {
                const destDir = path.dirname(this.opts.destPath);
                if (!fs.existsSync(destDir))
                    fs.mkdirSync(destDir, { recursive: true });
                const fd = fs.openSync(this.opts.destPath, "w");
                try {
                    fs.ftruncateSync(fd, this.opts.totalSize);
                }
                finally {
                    fs.closeSync(fd);
                }
            }
            const worker = new worker_threads_1.Worker(this.opts.workerPath, {
                workerData: { src: this.opts.tmpPath, dest: this.opts.destPath, srcOffset, length },
            });
            worker.on("message", (msg) => {
                if (msg.type === "progress" && onProgress && msg.bytes !== undefined) {
                    onProgress(msg.bytes);
                }
                else if (msg.type === "done") {
                    resolve();
                }
                else if (msg.type === "error") {
                    reject(new Error(msg.message));
                }
            });
            worker.on("error", reject);
            worker.on("exit", code => {
                if (code !== 0)
                    reject(new Error(`Copy worker exited ${code}`));
            });
        });
    }
}
exports.PipelineManager = PipelineManager;
