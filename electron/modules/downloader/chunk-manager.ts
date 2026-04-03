import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { ChunkState, DownloadState } from "./types";
import { StateManager } from "./state-manager";

export interface ChunkManagerOptions {
  maxConnections?: number;
  initialConnections?: number;
  chunkSize?: number;
  retryLimit?: number;
  retryDelay?: number;
  bandwidthLimitBps?: number;
  isHDD?: boolean;
}

export interface ChunkProgress {
  chunkIndex: number;
  bytesWritten: number;
  totalBytes: number;
}

export type ChunkManagerEvents = {
  progress: (p: ChunkProgress) => void;
  chunkComplete: (index: number) => void;
  chunkError: (index: number, err: Error, attempt: number) => void;
  complete: () => void;
  error: (err: Error) => void;
};

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB per chunk
const WRITE_HIGH_WATER = 4 * 1024 * 1024;    // 4MB write buffer

export class ChunkManager {
  private opts: Required<ChunkManagerOptions>;
  private stateManager: StateManager;
  private state: DownloadState;
  private fd: number = -1;
  private aborted = false;
  private activeCount = 0;
  private pendingQueue: ChunkState[] = [];
  private listeners: Partial<ChunkManagerEvents> = {};
  private bytesPerSecond = 0;
  private lastSpeedCheck = Date.now();
  private bytesInWindow = 0;
  private stateFlushTimer: NodeJS.Timeout | null = null;
  private pendingStateUpdates: { index: number; downloaded: number; completed: boolean }[] = [];

  constructor(
    state: DownloadState,
    stateManager: StateManager,
    opts: ChunkManagerOptions = {}
  ) {
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

  on<K extends keyof ChunkManagerEvents>(event: K, handler: ChunkManagerEvents[K]): this {
    this.listeners[event] = handler as any;
    return this;
  }

  private emit<K extends keyof ChunkManagerEvents>(event: K, ...args: Parameters<ChunkManagerEvents[K]>): void {
    const h = this.listeners[event] as ((...a: any[]) => void) | undefined;
    if (h) h(...args);
  }

  private totalDownloaded = 0; // live bytes downloaded in this session

  /**
   * Build chunk plan from state (supports resume) — use direct references, NOT clones
   */
  private buildQueue(): void {
    // Seed totalDownloaded from already-completed chunks (resume case)
    this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c.downloaded, 0);

    this.pendingQueue = this.state.chunks
      .filter(c => !c.completed);
    // NOTE: no .map(c => ({...c})) — we want direct references so state.chunks stays in sync
  }

  /**
   * Main entry — start downloading all pending chunks
   */
  async start(tmpFilePath: string): Promise<void> {
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
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.aborted) return;

        while (this.activeCount < this.currentMaxConnections() && this.pendingQueue.length > 0) {
          const chunk = this.pendingQueue.shift()!;
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
  private currentMaxConnections(): number {
    const elapsed = (Date.now() - this.lastSpeedCheck) / 1000;
    // Ramp up over first 10 seconds
    const rampFactor = Math.min(1, elapsed / 10);
    const target = Math.round(
      this.opts.initialConnections +
      (this.opts.maxConnections - this.opts.initialConnections) * rampFactor
    );
    return Math.max(this.opts.initialConnections, target);
  }

  /**
   * Download a single chunk with retry
   */
  private async downloadChunk(chunk: ChunkState, attempt: number): Promise<void> {
    if (this.aborted) return;

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
    } catch (err: any) {
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
  private fetchRange(chunk: ChunkState, rangeStart: number, rangeEnd: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(new Error("Aborted"));

      const url = new URL(this.state.firmware.url);
      const lib = url.protocol === "https:" ? https : http;
      const options: https.RequestOptions = {
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
        if (this.aborted) { res.destroy(); return reject(new Error("Aborted")); }

        if (res.statusCode !== 206 && res.statusCode !== 200) {
          res.destroy();
          return reject(new Error(`HTTP ${res.statusCode} for chunk ${chunk.index}`));
        }

        // writeHead tracks the exact file position for the next write
        let writeHead = rangeStart;
        const buffers: Buffer[] = [];
        let bufferedBytes = 0;
        let settled = false;

        const abortCheck = setInterval(() => {
          if (this.aborted) {
            clearInterval(abortCheck);
            if (!settled) { settled = true; res.destroy(); reject(new Error("Aborted")); }
          }
        }, 50);

        /**
         * Flush accumulated buffers to disk at the correct file offset.
         * Uses fs.writeSync so order is guaranteed — no async race on writeHead.
         */
        const flushBuffers = () => {
          if (buffers.length === 0) return;
          if (this.aborted || this.fd === -1) { buffers.length = 0; bufferedBytes = 0; return; }

          const combined = Buffer.concat(buffers);
          buffers.length = 0;
          bufferedBytes = 0;

          // Synchronous write — guarantees writeHead is correct before next flush
          try {
            fs.writeSync(this.fd, combined, 0, combined.length, writeHead);
          } catch (err: any) {
            if (!this.aborted) reject(err);
            return;
          }

          writeHead += combined.length;          // advance only AFTER successful write
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
            if (expectedMs > 5) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, expectedMs);
          }
        };

        res.on("data", (data: string | Buffer) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          buffers.push(buf);
          bufferedBytes += buf.length;

          if (bufferedBytes >= WRITE_HIGH_WATER) {
            flushBuffers();
          }
        });

        res.on("end", () => {
          clearInterval(abortCheck);
          if (settled) return;
          settled = true;
          flushBuffers(); // flush tail
          chunk.completed = true;
          this.queueStateUpdate(chunk.index, chunk.downloaded, true);
          this.emit("chunkComplete", chunk.index);
          resolve();
        });

        res.on("error", (err) => {
          clearInterval(abortCheck);
          if (!settled) { settled = true; reject(err); }
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
  private fallocate(fd: number, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.ftruncate(fd, size, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  private updateSpeed(): void {
    const now = Date.now();
    const elapsed = (now - this.lastSpeedCheck) / 1000;
    if (elapsed >= 1) {
      this.bytesPerSecond = Math.round(this.bytesInWindow / elapsed);
      this.bytesInWindow = 0;
      this.lastSpeedCheck = now;
    }
  }

  getSpeed(): number {
    return this.bytesPerSecond;
  }

  abort(): void {
    this.aborted = true;
    if (this.fd !== -1) {
      try { fs.closeSync(this.fd); } catch { }
      this.fd = -1;
    }
    this.flushStateNow();
  }

  private queueStateUpdate(index: number, downloaded: number, completed: boolean): void {
    const existing = this.pendingStateUpdates.find(u => u.index === index);
    if (existing) {
      existing.downloaded = downloaded;
      existing.completed = completed;
    } else {
      this.pendingStateUpdates.push({ index, downloaded, completed });
    }

    if (!this.stateFlushTimer) {
      this.stateFlushTimer = setTimeout(() => this.flushStateNow(), 2000);
    }
  }

  private flushStateNow(): void {
    if (this.stateFlushTimer) {
      clearTimeout(this.stateFlushTimer);
      this.stateFlushTimer = null;
    }
    if (this.pendingStateUpdates.length > 0) {
      this.stateManager.batchUpdateChunks(this.state.id, this.pendingStateUpdates);
      this.pendingStateUpdates = [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
  }
}
