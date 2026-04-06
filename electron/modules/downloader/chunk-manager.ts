import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
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
  adaptiveBuffer?: boolean;
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

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
const WRITE_HWM_FIXED   =   4 * 1024 * 1024;
const WRITE_HWM_MIN     =   4 * 1024 * 1024;
const WRITE_HWM_MAX     = 128 * 1024 * 1024;
const RAM_CACHE_TTL     = 5_000;

let cachedFreeRam = 0;
let ramCachedAt   = 0;

function getFreeRam(): number {
  const now = Date.now();
  if (now - ramCachedAt > RAM_CACHE_TTL) {
    cachedFreeRam = os.freemem();
    ramCachedAt   = now;
  }
  return cachedFreeRam;
}

function calcWriteHWM(): number {
  return Math.max(WRITE_HWM_MIN, Math.min(WRITE_HWM_MAX, getFreeRam() * 0.05));
}

function ramCapConnections(requested: number): number {
  const free = getFreeRam();
  if (free < 512 * 1024 * 1024) return Math.min(requested, 4);
  if (free < 1024 * 1024 * 1024) return Math.min(requested, 8);
  return requested;
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
  private stateFlushTimer: NodeJS.Timeout | null = null;
  private pendingStateUpdates: { index: number; downloaded: number; completed: boolean }[] = [];
  private totalDownloaded = 0;

  // ─── Speed tracking ──────────────────────────────────────────────────────
  private speedSamples: { bytes: number; ts: number }[] = [];
  private ewaBps = 0;
  private readonly SPEED_WINDOW_MS = 10_000;
  private readonly EWA_ALPHA       = 0.2;
  private lastFlushTs = Date.now();
  private bytesInInterval = 0;

  constructor(
    state: DownloadState,
    stateManager: StateManager,
    opts: ChunkManagerOptions = {}
  ) {
    this.state = state;
    this.stateManager = stateManager;

    const isHDD = opts.isHDD ?? false;
    this.opts = {
      maxConnections:     opts.maxConnections     ?? (isHDD ? 8 : 16),
      initialConnections: opts.initialConnections ?? 4,
      chunkSize:          opts.chunkSize          ?? DEFAULT_CHUNK_SIZE,
      retryLimit:         opts.retryLimit         ?? 3,
      retryDelay:         opts.retryDelay         ?? 2000,
      bandwidthLimitBps:  opts.bandwidthLimitBps  ?? 0,
      isHDD,
      adaptiveBuffer:     opts.adaptiveBuffer     ?? false,
    };
  }

  on<K extends keyof ChunkManagerEvents>(event: K, handler: ChunkManagerEvents[K]): this {
    this.listeners[event] = handler as any;
    return this;
  }

  private emit<K extends keyof ChunkManagerEvents>(
    event: K,
    ...args: Parameters<ChunkManagerEvents[K]>
  ): void {
    const h = this.listeners[event] as ((...a: any[]) => void) | undefined;
    if (h) h(...args);
  }

  private buildQueue(): void {
    this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c.downloaded, 0);
    this.pendingQueue = this.state.chunks.filter(c => !c.completed);
  }

  async start(tmpFilePath: string): Promise<void> {
    this.aborted = false;
    this.buildQueue();

    const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
    this.fd = fs.openSync(tmpFilePath, flags);

    if (flags === "w" && this.state.totalSize > 0) {
      await this.fallocate(this.fd, this.state.totalSize);
    }

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.aborted) return;

        const maxConn = this.opts.adaptiveBuffer
          ? ramCapConnections(this.currentMaxConnections())
          : this.currentMaxConnections();

        while (this.activeCount < maxConn && this.pendingQueue.length > 0) {
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
  }

  private currentMaxConnections(): number {
    const elapsed = (Date.now() - this.lastFlushTs) / 1000;
    const rampFactor = Math.min(1, elapsed / 10);
    return Math.round(
      this.opts.initialConnections +
      (this.opts.maxConnections - this.opts.initialConnections) * rampFactor
    );
  }

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

  private fetchRange(chunk: ChunkState, rangeStart: number, rangeEnd: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(new Error("Aborted"));

      const writeHWM = this.opts.adaptiveBuffer ? calcWriteHWM() : WRITE_HWM_FIXED;

      const url = new URL(this.state.firmware.url);
      const lib = url.protocol === "https:" ? https : http;
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port:     url.port || (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method:   "GET",
        headers: {
          "Range":      `bytes=${rangeStart}-${rangeEnd}`,
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

        const flushBuffers = () => {
          if (buffers.length === 0) return;
          if (this.aborted || this.fd === -1) { buffers.length = 0; bufferedBytes = 0; return; }

          const combined = Buffer.concat(buffers);
          buffers.length = 0;
          bufferedBytes = 0;

          try {
            fs.writeSync(this.fd, combined, 0, combined.length, writeHead);
          } catch (err: any) {
            if (!this.aborted) reject(err);
            return;
          }

          writeHead           += combined.length;
          chunk.downloaded     = writeHead - chunk.start;
          this.totalDownloaded += combined.length;

          this.updateSpeed(combined.length);
          this.queueStateUpdate(chunk.index, chunk.downloaded, false);
          this.emit("progress", {
            chunkIndex:   chunk.index,
            bytesWritten: this.totalDownloaded,
            totalBytes:   this.state.totalSize,
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
          if (bufferedBytes >= writeHWM) flushBuffers();
        });

        res.on("end", () => {
          clearInterval(abortCheck);
          if (settled) return;
          settled = true;
          flushBuffers();
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

  // ─── Speed / ETA ──────────────────────────────────────────────────────────

  /**
   * Tích lũy bytes, tạo sample mỗi ~1 giây, tính EWA.
   * Không reset về 0 giữa các giây — mượt và ổn định.
   */
  private updateSpeed(flushedBytes: number): void {
    this.bytesInInterval += flushedBytes;

    const now     = Date.now();
    const elapsed = now - this.lastFlushTs;
    if (elapsed < 1000) return;

    const instantBps = (this.bytesInInterval / elapsed) * 1000;
    this.bytesInInterval = 0;
    this.lastFlushTs     = now;

    this.speedSamples.push({ bytes: instantBps, ts: now });

    // Dọn samples cũ hơn SPEED_WINDOW_MS
    const cutoff = now - this.SPEED_WINDOW_MS;
    this.speedSamples = this.speedSamples.filter(s => s.ts >= cutoff);

    if (this.ewaBps === 0) {
      // Khởi tạo lần đầu = trung bình window
      this.ewaBps = this.speedSamples.reduce((s, x) => s + x.bytes, 0) / this.speedSamples.length;
    } else {
      this.ewaBps = this.EWA_ALPHA * instantBps + (1 - this.EWA_ALPHA) * this.ewaBps;
    }
  }

  /** EWA speed (bytes/s) — mượt, không nhảy */
  getSpeed(): number {
    return Math.round(this.ewaBps);
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────

  private fallocate(fd: number, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.ftruncate(fd, size, err => err ? reject(err) : resolve());
    });
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