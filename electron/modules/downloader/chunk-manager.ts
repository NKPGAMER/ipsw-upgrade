import * as fs from "fs";
import { URL } from "url";
import { Pool, type Dispatcher } from "undici";
import { CompactChunk, DownloadState } from "@custom-type/downloader";
import { StateManager } from "./state-manager";

export interface ChunkManagerOptions {
  maxConnections?: number;
  initialConnections?: number;
  chunkSize?: number;
  retryLimit?: number;
  retryDelay?: number;
  bandwidthLimitBps?: number;
  isHDD?: boolean;
  /** Allow TLS connections with invalid certificates (for development). */
  insecureTLS?: boolean;
  /** Buffer flush threshold in bytes */
  writeHighWater?: number;
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
const DEFAULT_WRITE_HIGH_WATER = 8 * 1024 * 1024; // 8 MB flush threshold

// ─── Speed / ETA smoothing ────────────────────────────────────────────────────
const SPEED_WINDOW_MS = 8_000;
const SPEED_ALPHA     = 0.15;
const ETA_ALPHA       = 0.15;

function makePool(origin: string, maxConnections: number, insecureTLS = false): Pool {
  return new Pool(origin, {
    connections: maxConnections,
    pipelining: 1,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connect: {
      ...(insecureTLS ? { rejectUnauthorized: false } : {}),
      timeout: 15_000,
    },
    bodyTimeout: 60_000,
    headersTimeout: 15_000,
  });
}

// ─── ChunkManager ──────────────────────────────────────────────────────────────

export class ChunkManager {
  private opts: Required<Omit<ChunkManagerOptions, "insecureTLS" | "chunkHashQueue" | "writeHighWater">>;
  private stateManager: StateManager;
  private state: DownloadState;
  private fd: number = -1;
  private aborted = false;
  private activeCount = 0;
  private pendingQueue: CompactChunk[] = [];
  private listeners: Partial<ChunkManagerEvents> = {};
  private bytesPerSecond = 0;
  private lastSpeedCheck = Date.now();
  private speedSamples: { timestamp: number; downloaded: number }[] = [];
  private smoothedSpeed = 0;
  private smoothedEta = 0;

  // ── AIMD congestion control ────────────────────────────────────────────
  private aimdConnections = 0;
  private lastAIMDCheck = 0;
  private maxSeenSpeed = 0;
  private previousSpeed = 0;

  private stateFlushTimer: NodeJS.Timeout | null = null;
  private pendingStateUpdates: { start: number; downloaded: number }[] = [];
  private pool!: Pool;
  private totalDownloaded = 0;

  private insecureTLS: boolean;
  private writeHighWater: number;

  private isWholeFileRequest(rangeStart: number, rangeEnd: number): boolean {
    if (this.state.supportsRanges) return false;
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

    this.insecureTLS = opts.insecureTLS ?? false;
    this.writeHighWater = opts.writeHighWater ?? DEFAULT_WRITE_HIGH_WATER;
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
    this.totalDownloaded = this.state.chunks.reduce((sum, c) => sum + c[2], 0);
    this.pendingQueue = [...this.state.chunks];
  }

  // ─── Main entry ─────────────────────────────────────────────────────────────

  async start(tmpFilePath: string): Promise<void> {
    this.aborted = false;
    this.buildQueue();

    this.speedSamples = [];
    this.smoothedSpeed = 0;
    this.smoothedEta = 0;
    this.aimdConnections = 0;
    this.lastAIMDCheck = 0;
    this.maxSeenSpeed = 0;
    this.previousSpeed = 0;

    const url = new URL(this.state.firmware.url);
    this.pool = makePool(url.origin, this.opts.maxConnections, this.insecureTLS);

    // Open file for random-access write
    const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
    this.fd = fs.openSync(tmpFilePath, flags);

    try {
      if (flags === "w" && this.state.totalSize > 0) {
        await this.fallocate(this.fd, this.state.totalSize);
      }

      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (this.aborted) {
            if (this.activeCount === 0) {
              reject(new Error("Aborted"));
            }
            return;
          }

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
      await this.pool.destroy().catch(() => {});
    }
  }

  // ─── Adaptive concurrency (AIMD) ──────────────────────────────────────────

  private currentMaxConnections(): number {
    const now = Date.now();

    if (this.lastAIMDCheck === 0) {
      this.lastAIMDCheck = now;
      this.aimdConnections = this.opts.initialConnections;
      return this.aimdConnections;
    }

    if (now - this.lastAIMDCheck < 3_000) {
      return Math.max(
        this.opts.initialConnections,
        Math.min(this.opts.maxConnections, this.aimdConnections),
      );
    }

    this.lastAIMDCheck = now;
    const currentSpeed = this.smoothedSpeed;

    if (currentSpeed <= 0 || this.previousSpeed <= 0) {
      this.previousSpeed = currentSpeed;
      this.maxSeenSpeed = Math.max(this.maxSeenSpeed, currentSpeed);
      return Math.max(
        this.opts.initialConnections,
        Math.min(this.opts.maxConnections, this.aimdConnections),
      );
    }

    this.maxSeenSpeed = Math.max(this.maxSeenSpeed, currentSpeed);

    if (currentSpeed >= this.previousSpeed * 0.8) {
      this.aimdConnections = Math.min(this.opts.maxConnections, this.aimdConnections + 1);
    } else if (currentSpeed < this.maxSeenSpeed * 0.5) {
      this.aimdConnections = Math.max(
        this.opts.initialConnections,
        Math.floor(this.aimdConnections / 2),
      );
    } else {
      this.aimdConnections = Math.max(
        this.opts.initialConnections,
        this.aimdConnections - 2,
      );
    }

    this.previousSpeed = currentSpeed;
    return this.aimdConnections;
  }

  // ─── Chunk download with retry ──────────────────────────────────────────────

  private async downloadChunk(chunk: CompactChunk, attempt: number): Promise<void> {
    if (this.aborted) return;

    const rangeStart = chunk[0] + chunk[2];
    const rangeEnd   = chunk[1];

    if (rangeStart >= rangeEnd + 1) {
      this.queueStateUpdate(chunk[0], chunk[1] - chunk[0] + 1);
      this.emit("chunkComplete", chunk[0]);
      return;
    }

    if (rangeStart > rangeEnd) {
      this.queueStateUpdate(chunk[0], chunk[1] - chunk[0] + 1);
      this.emit("chunkComplete", chunk[0]);
      return;
    }

    try {
      await this.fetchRange(chunk, rangeStart, rangeEnd);
    } catch (err: any) {
      this.emit("chunkError", chunk[0], err, attempt);
      if (attempt < this.opts.retryLimit && !this.aborted) {
        await this.sleep(this.opts.retryDelay * (attempt + 1));
        return this.downloadChunk(chunk, attempt + 1);
      }
      throw new Error(`Chunk ${chunk[0]} failed after ${attempt + 1} attempts: ${err.message}`);
    }
  }

  private async fetchRange(chunk: CompactChunk, rangeStart: number, rangeEnd: number): Promise<void> {
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
          "accept-encoding": "identity",
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
      throw new Error(`Server ignored range request for chunk ${chunk[0]}`);
    }

    if (response.statusCode !== 206 && response.statusCode !== 200) {
      await response.body.dump();
      throw new Error(`HTTP ${response.statusCode} for chunk ${chunk[0]}`);
    }

    if (response.statusCode === 206) {
      const cr = (response.headers["content-range"] as string) || "";
      const m = cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if (!m) {
        await response.body.dump();
        throw new Error(`Missing or malformed Content-Range header for chunk ${chunk[0]}`);
      }
      const svStart = parseInt(m[1]);
      const svEnd   = parseInt(m[2]);
      if (svStart !== rangeStart || svEnd !== rangeEnd) {
        await response.body.dump();
        throw new Error(
          `Content-Range mismatch for chunk ${chunk[0]}: server returned ` +
          `${svStart}-${svEnd}, requested ${rangeStart}-${rangeEnd}`
        );
      }
    }

    // ── Stream body → disk ────────────────────────────────────────────────────
    let writeHead  = rangeStart;
    const buffers: Buffer[] = [];
    let bufferedBytes = 0;

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
      chunk[2]                = writeHead - chunk[0];
      this.totalDownloaded   += combined.length;

      this.updateSpeed();
      this.queueStateUpdate(chunk[0], chunk[2]);
      this.emit("progress", {
        chunkIndex:   chunk[0],
        bytesWritten: this.totalDownloaded,
        totalBytes:   this.state.totalSize,
      });

      if (this.opts.bandwidthLimitBps > 0) {
        const throttleMs = (combined.length / this.opts.bandwidthLimitBps) * 1000;
        if (throttleMs > 5) await this.sleep(throttleMs);
      }
    };

    for await (const data of response.body) {
      if (this.aborted) {
        await response.body.dump().catch(() => {});
        throw new Error("Aborted");
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buffers.push(buf);
      bufferedBytes += buf.length;

      if (bufferedBytes >= this.writeHighWater) {
        await flushBuffers();
      }
    }

    await flushBuffers();

    const expectedBytes = rangeEnd - rangeStart + 1;
    const receivedBytes = writeHead - rangeStart;
    if (!this.isWholeFileRequest(rangeStart, rangeEnd) && receivedBytes !== expectedBytes) {
      throw new Error(
        `Chunk ${chunk[0]} body truncated: expected ${expectedBytes} bytes, ` +
        `received ${receivedBytes} bytes for range ${rangeStart}-${rangeEnd}`
      );
    }

    chunk[2] = chunk[1] - chunk[0] + 1;
    this.queueStateUpdate(chunk[0], chunk[2]);
    this.emit("chunkComplete", chunk[0]);
  }

  // ─── HEAD request ──────────────────────────────────────────────────────────

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

  updateMaxConnections(newMax: number): void {
    this.opts.maxConnections = newMax;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private fallocate(fd: number, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.ftruncate(fd, size, err => (err ? reject(err) : resolve()));
    });
  }

  private updateSpeed(): void {
    const now = Date.now();
    this.speedSamples.push({ timestamp: now, downloaded: this.totalDownloaded });

    const cutoff = now - SPEED_WINDOW_MS;
    while (this.speedSamples.length > 0 && this.speedSamples[0].timestamp < cutoff) {
      this.speedSamples.shift();
    }

    if (this.speedSamples.length >= 2) {
      const oldest = this.speedSamples[0];
      const latest = this.speedSamples[this.speedSamples.length - 1];
      const elapsed = (latest.timestamp - oldest.timestamp) / 1000;
      if (elapsed > 0.5) {
        const windowSpeed = (latest.downloaded - oldest.downloaded) / elapsed;
        this.bytesPerSecond = Math.round(windowSpeed);

        this.smoothedSpeed = this.smoothedSpeed === 0
          ? windowSpeed
          : this.smoothedSpeed * (1 - SPEED_ALPHA) + windowSpeed * SPEED_ALPHA;
      }
    }
  }

  getSpeed(): number { return this.bytesPerSecond; }

  getStableSpeed(): number {
    return Math.round(this.smoothedSpeed);
  }

  getStableEta(totalBytes: number, downloadedBytes: number): number | undefined {
    const speed = this.smoothedSpeed;
    if (speed <= 0) return undefined;

    const remaining = totalBytes - downloadedBytes;
    if (remaining <= 0) return 0;

    const rawEta = remaining / speed;
    this.smoothedEta = this.smoothedEta === 0
      ? rawEta
      : this.smoothedEta * (1 - ETA_ALPHA) + rawEta * ETA_ALPHA;

    return Math.round(this.smoothedEta);
  }

  abort(): void {
    this.aborted = true;
    if (this.pool) {
      this.pool.destroy().catch(() => {});
    }
    if (this.fd !== -1) {
      try { fs.closeSync(this.fd); } catch { }
      this.fd = -1;
    }
    this.flushStateNow();
  }

  private queueStateUpdate(start: number, downloaded: number): void {
    const existing = this.pendingStateUpdates.find(u => u.start === start);
    if (existing) { existing.downloaded = downloaded; }
    else this.pendingStateUpdates.push({ start, downloaded });

    if (!this.stateFlushTimer) {
      this.stateFlushTimer = setTimeout(() => this.flushStateNow(), 2000);
    }
  }

  private flushStateNow(): void {
    if (this.stateFlushTimer) { clearTimeout(this.stateFlushTimer); this.stateFlushTimer = null; }
    if (this.pendingStateUpdates.length > 0) {
      for (const u of this.pendingStateUpdates) {
        const idx = this.state.chunks.findIndex(c => c[0] === u.start);
        if (idx !== -1) {
          const chunk = this.state.chunks[idx];
          chunk[2] = u.downloaded;
          if (u.downloaded >= chunk[1] - chunk[0] + 1) {
            this.state.chunks.splice(idx, 1);
          }
        }
      }
      this.stateManager.batchUpdateChunks(this.state.id, this.pendingStateUpdates);
      this.pendingStateUpdates = [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
  }
}
