import * as fs from "fs";
import { URL } from "url";
import { Pool, type Dispatcher } from "undici";
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

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;   // 32 MB per chunk
const WRITE_HIGH_WATER   = 8 * 1024 * 1024;    // 8 MB — flush threshold (larger = fewer syscalls)

/** undici Pool options tuned for bulk file transfer */
function makePool(origin: string, maxConnections: number): Pool {
  return new Pool(origin, {
    connections: maxConnections,
    pipelining: 1,                // HTTP/1.1 keep-alive; 1 avoids HOL blocking on range requests
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connect: {
      rejectUnauthorized: false,  // Apple CDN uses valid certs — set true in prod if preferred
      timeout: 15_000,
    },
    bodyTimeout: 60_000,
    headersTimeout: 15_000,
  });
}

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
  private pool!: Pool;
  private totalDownloaded = 0;

  private isWholeFileRequest(rangeStart: number, rangeEnd: number): boolean {
    if (this.state.chunks.length !== 1) return false;
    if (rangeStart !== 0) return false;
    if (this.state.totalSize <= 0) return true;
    return rangeEnd === this.state.totalSize - 1;
  }

  constructor(
    state: DownloadState,
    stateManager: StateManager,
    opts: ChunkManagerOptions = {}
  ) {
    this.state = state;
    this.stateManager = stateManager;

    const isHDD = opts.isHDD ?? false;
    this.opts = {
      maxConnections:        opts.maxConnections        ?? (isHDD ? 8 : 16),
      initialConnections:    opts.initialConnections    ?? 4,
      chunkSize:             opts.chunkSize             ?? DEFAULT_CHUNK_SIZE,
      retryLimit:            opts.retryLimit            ?? 3,
      retryDelay:            opts.retryDelay            ?? 2000,
      bandwidthLimitBps:     opts.bandwidthLimitBps     ?? 0,
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

  // ─── Queue ───────────────────────────────────────────────────────────────────

  private buildQueue(): void {
    this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c.downloaded, 0);
    this.pendingQueue = this.state.chunks.filter(c => !c.completed);
  }

  // ─── Main entry ─────────────────────────────────────────────────────────────

  async start(tmpFilePath: string): Promise<void> {
    this.aborted = false;
    this.buildQueue();

    const url = new URL(this.state.firmware.url);
    this.pool = makePool(url.origin, this.opts.maxConnections);

    // Open file for random-access write
    const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
    this.fd = fs.openSync(tmpFilePath, flags);

    // Pre-allocate to avoid fragmentation (especially on HDD)
    if (flags === "w" && this.state.totalSize > 0) {
      await this.fallocate(this.fd, this.state.totalSize);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (this.aborted) return;

          while (
            this.activeCount < this.currentMaxConnections() &&
            this.pendingQueue.length > 0
          ) {
            const chunk = this.pendingQueue.shift()!;
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
    } finally {
      // Always destroy the pool when done or aborted
      await this.pool.destroy().catch(() => {});
    }
  }

  // ─── Adaptive concurrency ────────────────────────────────────────────────────

  private currentMaxConnections(): number {
    const elapsed = (Date.now() - this.lastSpeedCheck) / 1000;
    const rampFactor = Math.min(1, elapsed / 10);
    const target = Math.round(
      this.opts.initialConnections +
      (this.opts.maxConnections - this.opts.initialConnections) * rampFactor
    );
    return Math.max(this.opts.initialConnections, target);
  }

  // ─── Chunk download with retry ───────────────────────────────────────────────

  private async downloadChunk(chunk: ChunkState, attempt: number): Promise<void> {
    if (this.aborted) return;

    const start = chunk.start + chunk.downloaded;
    const end   = chunk.end;

    if (start > end) {
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
   * Fetch byte range via undici Pool, write with async fs.write (non-blocking I/O).
   * Uses async-iterator on the response body for built-in back-pressure.
   */
  private async fetchRange(chunk: ChunkState, rangeStart: number, rangeEnd: number): Promise<void> {
    if (this.aborted) throw new Error("Aborted");

    const url  = new URL(this.state.firmware.url);
    const path = url.pathname + url.search;

    let response: Dispatcher.ResponseData;
    try {
      response = await this.pool.request({
        origin: url.origin,
        path,
        method: "GET",
        headers: {
          "range":       `bytes=${rangeStart}-${rangeEnd}`,
          "user-agent":  "iTunes/12.12.10",
          "connection":  "keep-alive",
          "accept-encoding": "identity",  // Disable compression — we need exact byte ranges
        },
        headersTimeout: 15_000,
        bodyTimeout:    120_000
      });
    } catch (err: any) {
      if (this.aborted) throw new Error("Aborted");
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
    let writeHead  = rangeStart;
    const buffers: Buffer[] = [];
    let bufferedBytes = 0;

    /**
     * Async write — avoids blocking the event loop unlike writeSync.
     * Returns a promise so we can await it before advancing writeHead.
     */
    const flushBuffers = async (): Promise<void> => {
      if (buffers.length === 0) return;
      if (this.aborted || this.fd === -1) { buffers.length = 0; bufferedBytes = 0; return; }

      const combined = Buffer.concat(buffers);
      buffers.length = 0;
      bufferedBytes = 0;

      await new Promise<void>((res, rej) =>
        fs.write(this.fd, combined, 0, combined.length, writeHead, (e) => (e ? rej(e) : res()))
      );

      writeHead              += combined.length;
      chunk.downloaded        = writeHead - chunk.start;
      this.totalDownloaded   += combined.length;
      this.bytesInWindow     += combined.length;

      this.updateSpeed();
      this.queueStateUpdate(chunk.index, chunk.downloaded, false);
      this.emit("progress", {
        chunkIndex:   chunk.index,
        bytesWritten: this.totalDownloaded,
        totalBytes:   this.state.totalSize,
      });

      // Bandwidth throttle (optional)
      if (this.opts.bandwidthLimitBps > 0) {
        const throttleMs = (combined.length / this.opts.bandwidthLimitBps) * 1000;
        if (throttleMs > 5) await this.sleep(throttleMs);
      }
    };

    // undici body is a web ReadableStream / AsyncIterable<Buffer>
    for await (const data of response.body) {
      if (this.aborted) {
        await response.body.dump().catch(() => {});
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

  static async fetchMetadata(url: string): Promise<{ contentLength: number; acceptsRanges: boolean }> {
    const parsed = new URL(url);
    const pool   = new Pool(parsed.origin, { connections: 1, headersTimeout: 15_000 });
    try {
      const res = await pool.request({
        origin: parsed.origin,
        path:   parsed.pathname + parsed.search,
        method: "HEAD",
        headers: { "user-agent": "iTunes/12.12.10" },
      });
      await res.body.dump();
      const contentLength  = parseInt((res.headers["content-length"] as string) || "0");
      const acceptsRanges  = res.headers["accept-ranges"] === "bytes";
      return { contentLength, acceptsRanges };
    } finally {
      await pool.destroy().catch(() => {});
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private fallocate(fd: number, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.ftruncate(fd, size, err => (err ? reject(err) : resolve()));
    });
  }

  private updateSpeed(): void {
    const now     = Date.now();
    const elapsed = (now - this.lastSpeedCheck) / 1000;
    if (elapsed >= 1) {
      this.bytesPerSecond = Math.round(this.bytesInWindow / elapsed);
      this.bytesInWindow  = 0;
      this.lastSpeedCheck = now;
    }
  }

  getSpeed(): number { return this.bytesPerSecond; }

  abort(): void {
    this.aborted = true;
    if (this.fd !== -1) {
      try { fs.closeSync(this.fd); } catch { }
      this.fd = -1;
    }
    this.flushStateNow();
    // pool.destroy() is called in start()'s finally block
  }

  private queueStateUpdate(index: number, downloaded: number, completed: boolean): void {
    const existing = this.pendingStateUpdates.find(u => u.index === index);
    if (existing) { existing.downloaded = downloaded; existing.completed = completed; }
    else this.pendingStateUpdates.push({ index, downloaded, completed });

    if (!this.stateFlushTimer) {
      this.stateFlushTimer = setTimeout(() => this.flushStateNow(), 2000);
    }
  }

  private flushStateNow(): void {
    if (this.stateFlushTimer) { clearTimeout(this.stateFlushTimer); this.stateFlushTimer = null; }
    if (this.pendingStateUpdates.length > 0) {
      this.stateManager.batchUpdateChunks(this.state.id, this.pendingStateUpdates);
      this.pendingStateUpdates = [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
  }
}
