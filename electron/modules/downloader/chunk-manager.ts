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
  turboConnectionsMultiplier?: number;
  /** HDD+SSD turbo config — when set, completed chunks are streamed from tmp to .turbo on HDD */
  turboHddSsd?: {
    turboPath: string;
    onTurboMove?: (info: TurboMoveInfo) => void;
    onTurboHddError?: (err: Error) => void;
  };
  /** DiskManager for dual-disk space check */
  tmpDiskAvailable?: number;
  hddDiskAvailable?: number;
  /** Allow TLS connections with invalid certificates (for development). */
  insecureTLS?: boolean;
}

export interface TurboMoveInfo {
  chunkIndex: number;
  movedBytes: number;
  totalMovedBytes: number;
  totalSize: number;
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
  turboHddError: (err: Error) => void;
  turboMove: (info: TurboMoveInfo) => void;
  degraded: () => void;
};

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;   // 32 MB per chunk
const WRITE_HIGH_WATER   = 8 * 1024 * 1024;    // 8 MB — flush threshold

// ─── Speed / ETA smoothing (skill: stable-download-speed) ─────────────────────
const SPEED_WINDOW_MS = 8_000;   // sliding window: 8 seconds
const SPEED_ALPHA     = 0.15;    // speed EMA factor
const ETA_ALPHA       = 0.15;    // ETA EMA factor

/** undici Pool options tuned for bulk file transfer */
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

// ─── IOWriteQueue ──────────────────────────────────────────────────────────────

interface QueuedChunk {
  chunkIndex: number;
  start: number;
  end: number;
  size: number;    // end - start + 1
}

class IOWriteQueue {
  private queue: QueuedChunk[] = [];
  private activeCount = 0;
  private totalMovedBytes = 0;
  private stateManager: StateManager;
  private stateId: string;
  private onMove?: (info: TurboMoveInfo) => void;
  private onError?: (err: Error) => void;
  private totalSize: number;
  private stopped = false;
  private drainResolve: (() => void) | null = null;

  constructor(
    private tmpPath: string,
    private turboPath: string,
    stateManager: StateManager,
    stateId: string,
    totalSize: number,
    onMove?: (info: TurboMoveInfo) => void,
    onError?: (err: Error) => void,
    private maxConcurrency: number = 2,
  ) {
    this.stateManager = stateManager;
    this.stateId = stateId;
    this.totalSize = totalSize;
    this.onMove = onMove;
    this.onError = onError;
  }

  enqueue(chunk: QueuedChunk): void {
    this.queue.push(chunk);
    this.scheduleNext();
  }

  /**
   * Fill up to maxConcurrency slots. Each move runs independently;
   * on completion it cascades to fill the next slot.
   */
  private scheduleNext(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0 && !this.stopped) {
      const chunk = this.queue.shift()!;
      this.activeCount++;
      this.moveChunk(chunk)
        .catch((err: any) => {
          this.stopped = true;
          if (this.onError) this.onError(err);
        })
        .finally(() => {
          this.activeCount--;
          if (!this.stopped) this.scheduleNext();
          this.checkDrain();
        });
    }
  }

  /** Resolve the drain promise when everything is idle. */
  private checkDrain(): void {
    if (this.drainResolve && this.queue.length === 0 && this.activeCount === 0) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  private moveChunk(chunk: QueuedChunk): Promise<void> {
    return new Promise<void>((resolve, reject) => {
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
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        readStream.destroy();
        writeStream.destroy();
        reject(err);
      };

      readStream.on("data", (data: string | Buffer) => {
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

      readStream.on("error", fail);
      writeStream.on("error", fail);

      writeStream.on("finish", () => {
        // Persist movedChunks after each complete chunk (not per fragment)
        this.stateManager.addMovedChunk(this.stateId, chunk.chunkIndex);
        resolve();
      });

      readStream.pipe(writeStream);
    });
  }

  /**
   * Stop — finish in-flight moves then discard the rest of the queue.
   * If multiple chunks are being moved concurrently, all of them finish
   * before the promise resolves.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    while (this.activeCount > 0) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  /**
   * Drain every queued chunk, then return.  If the HDD errors mid-drain the
   * stopped flag is raised and we return early — the caller checks movedChunks.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeCount === 0) return;
    return new Promise<void>(resolve => {
      this.drainResolve = resolve;
      this.checkDrain();
    });
  }

  get hasPending(): boolean {
    return this.queue.length > 0 || this.activeCount > 0;
  }

  getTotalMovedBytes(): number {
    return this.totalMovedBytes;
  }

  setTotalMovedBytes(bytes: number): void {
    this.totalMovedBytes = bytes;
  }
}

// ─── ChunkManager ──────────────────────────────────────────────────────────────

export class ChunkManager {
  private opts: Required<Omit<ChunkManagerOptions, "turboHddSsd" | "tmpDiskAvailable" | "hddDiskAvailable" | "insecureTLS">>;
  private stateManager: StateManager;
  private state: DownloadState;
  private fd: number = -1;
  private aborted = false;
  private activeCount = 0;
  private pendingQueue: ChunkState[] = [];
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
  private pendingStateUpdates: { index: number; downloaded: number; completed: boolean }[] = [];
  private pool!: Pool;
  private totalDownloaded = 0;

  // ── TLS / security ──────────────────────────────────────────────────────
  private insecureTLS: boolean;

  // ── Turbo / promotion state ─────────────────────────────────────────────
  private ioWriteQueue: IOWriteQueue | null = null;
  private turboHddSsd: ChunkManagerOptions["turboHddSsd"];
  private promoting = false;
  private promoteResolve: (() => void) | null = null;
  private turboPath: string | null = null;
  private triggerTick: (() => void) | null = null; // re-trigger after promotion

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
      turboConnectionsMultiplier: opts.turboConnectionsMultiplier ?? 1.0,
    };

    this.turboHddSsd = opts.turboHddSsd;
    this.insecureTLS = opts.insecureTLS ?? false;
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

    // Reset speed/ETA smoothing and AIMD state for a fresh ramp-up
    this.speedSamples = [];
    this.smoothedSpeed = 0;
    this.smoothedEta = 0;
    this.aimdConnections = 0;
    this.lastAIMDCheck = 0;
    this.maxSeenSpeed = 0;
    this.previousSpeed = 0;

    const url = new URL(this.state.firmware.url);
    this.pool = makePool(url.origin, this.opts.maxConnections, this.insecureTLS);

    // ── Dual-disk space check ──────────────────────────────────────────────
    // If turboHddSsd was set, verify both disks have space before allocating
    if (this.turboHddSsd) {
      const tmpDir = require("path").dirname(tmpFilePath);
      const hddDir = require("path").dirname(this.turboHddSsd.turboPath);

      try {
        // Check tmp disk (SSD)
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpStats = await fs.promises.statfs(tmpDir).catch(() => null);
        const tmpFree = tmpStats ? tmpStats.bavail * tmpStats.bsize : 0;
        const tmpNeeded = this.state.totalSize;

        // Check HDD disk
        if (!fs.existsSync(hddDir)) fs.mkdirSync(hddDir, { recursive: true });
        const hddStats = await fs.promises.statfs(hddDir).catch(() => null);
        const hddFree = hddStats ? hddStats.bavail * hddStats.bsize : 0;
        const hddNeeded = this.state.totalSize;

        if (tmpFree > 0 && tmpFree < tmpNeeded && hddFree >= hddNeeded) {
          // SSD full, HDD OK → degrade to hdd_only
          this.turboHddSsd = undefined;
          this.turboPath = null;
          this.emit("degraded");
        }
      } catch {
        // statfs not available on older Node — skip check, proceed optimistically
      }
    }

    // Open file for random-access write
    const flags = fs.existsSync(tmpFilePath) ? "r+" : "w";
    this.fd = fs.openSync(tmpFilePath, flags);

    try {
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
      this.ioWriteQueue = new IOWriteQueue(
        tmpFilePath,
        this.turboPath,
        this.stateManager,
        this.state.id,
        this.state.totalSize,
        (info) => {
          this.emit("turboMove", info);
          if (this.turboHddSsd?.onTurboMove) this.turboHddSsd.onTurboMove(info);
        },
        (err) => {
          this.emit("turboHddError", err);
          if (this.turboHddSsd?.onTurboHddError) this.turboHddSsd.onTurboHddError(err);
        },
      );

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

    } catch (err) {
      try { fs.closeSync(this.fd); } catch { }
      this.fd = -1;
      throw err;
    }

    try {
      await new Promise<void>((resolve, reject) => {
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
            if (this.activeCount === 0) {
              // All in-flight chunks done — complete promotion now
              this.pendingQueue = this.state.chunks.filter(c => !c.completed);
              this.promoting = false;
              const resolve = this.promoteResolve;
              this.promoteResolve = null;
              resolve?.();
              tick(); // Continue with turbo settings
            }
            return;
          }

          while (
            this.activeCount < this.currentMaxConnections() &&
            this.pendingQueue.length > 0 &&
            !this.promoting
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
            this.triggerTick = null;
            this.emit("complete");
            resolve();
          }
        };

        this.triggerTick = tick;
        tick();
      });
    } finally {
      await this.pool.destroy().catch(() => {});
    }
  }

  // ─── Adaptive concurrency (AIMD) ──────────────────────────────────────────

  /**
   * Throughput-based Additive Increase / Multiplicative Decrease.
   *
   * - Starts at `initialConnections`
   * - Every ~3 seconds evaluates smoothed speed via the sliding-window + EMA pipeline
   * - If speed is stable or growing → +1 connection (Additive Increase)
   * - If speed drops >20% from previous → -2 connections (Multiplicative Decrease)
   * - If speed drops >50% from max seen → halve connections (aggressive backoff)
   * - Always clamped to [`initialConnections`, `maxConnections`]
   *
   * Replaces the old fixed 10-second linear ramp which didn't adapt to
   * actual network conditions.
   */
  private currentMaxConnections(): number {
    const now = Date.now();

    // First call: initialise at the floor
    if (this.lastAIMDCheck === 0) {
      this.lastAIMDCheck = now;
      this.aimdConnections = this.opts.initialConnections;
      return this.aimdConnections;
    }

    // Only re-evaluate every ~3 s (called on every chunk completion)
    if (now - this.lastAIMDCheck < 3_000) {
      return Math.max(
        this.opts.initialConnections,
        Math.min(this.opts.maxConnections, this.aimdConnections),
      );
    }

    this.lastAIMDCheck = now;
    const currentSpeed = this.smoothedSpeed;

    // Not enough throughput data yet — hold steady
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
      // Stable or growing → Additive Increase
      this.aimdConnections = Math.min(this.opts.maxConnections, this.aimdConnections + 1);
    } else if (currentSpeed < this.maxSeenSpeed * 0.5) {
      // Dropped >50 % of max seen → halve (aggressive backoff)
      this.aimdConnections = Math.max(
        this.opts.initialConnections,
        Math.floor(this.aimdConnections / 2),
      );
    } else {
      // Dropped >20 % (but ≤50 %) → Multiplicative Decrease
      this.aimdConnections = Math.max(
        this.opts.initialConnections,
        this.aimdConnections - 2,
      );
    }

    this.previousSpeed = currentSpeed;
    return this.aimdConnections;
  }

  // ─── Chunk download with retry ──────────────────────────────────────────────

  private async downloadChunk(chunk: ChunkState, attempt: number): Promise<void> {
    if (this.aborted) return;

    const start = chunk.start + chunk.downloaded;
    const end   = chunk.end;

    if (start >= end && chunk.completed) return;

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
    } catch (err: any) {
      this.emit("chunkError", chunk.index, err, attempt);
      if (attempt < this.opts.retryLimit && !this.aborted) {
        await this.sleep(this.opts.retryDelay * (attempt + 1));
        return this.downloadChunk(chunk, attempt + 1);
      }
      throw new Error(`Chunk ${chunk.index} failed after ${attempt + 1} attempts: ${err.message}`);
    }
  }

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
      throw new Error(`Server ignored range request for chunk ${chunk.index}`);
    }

    if (response.statusCode !== 206 && response.statusCode !== 200) {
      await response.body.dump();
      throw new Error(`HTTP ${response.statusCode} for chunk ${chunk.index}`);
    }

    // Validate Content-Range matches what we requested (206 only)
    if (response.statusCode === 206) {
      const cr = (response.headers["content-range"] as string) || "";
      const m = cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if (!m) {
        await response.body.dump();
        throw new Error(`Missing or malformed Content-Range header for chunk ${chunk.index}`);
      }
      const svStart = parseInt(m[1]);
      const svEnd   = parseInt(m[2]);
      if (svStart !== rangeStart || svEnd !== rangeEnd) {
        await response.body.dump();
        throw new Error(
          `Content-Range mismatch for chunk ${chunk.index}: server returned ` +
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
      chunk.downloaded        = writeHead - chunk.start;
      this.totalDownloaded   += combined.length;

      this.updateSpeed();
      this.queueStateUpdate(chunk.index, chunk.downloaded, false);
      this.emit("progress", {
        chunkIndex:   chunk.index,
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

      if (bufferedBytes >= WRITE_HIGH_WATER) {
        await flushBuffers();
      }
    }

    await flushBuffers();

    // Validate received byte count matches expected range length.
    // Skip validation for valid whole-file single-request downloads (200 with one chunk).
    const expectedBytes = rangeEnd - rangeStart + 1;
    const receivedBytes = writeHead - rangeStart;
    if (!this.isWholeFileRequest(rangeStart, rangeEnd) && receivedBytes !== expectedBytes) {
      throw new Error(
        `Chunk ${chunk.index} body truncated: expected ${expectedBytes} bytes, ` +
        `received ${receivedBytes} bytes for range ${rangeStart}-${rangeEnd}`
      );
    }

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

  // ─── Promotion ──────────────────────────────────────────────────────────────

  /**
   * Promote a normal download to turbo. Creates the IOWriteQueue and enqueues
   * already-completed chunks so they're moved tmp → .turbo in the background.
   * Partially-downloaded chunks stay on tmp and will be enqueued when they
   * complete. The download fd stays on SSD tmp — the download never touches HDD.
   *
   * Instead of blocking on in-flight chunk downloads, sets up the IOWriteQueue
   * immediately and returns a promise that resolves when the last in-flight
   * chunk finishes naturally. The tick() loop detects activeCount === 0 and
   * completes the promotion (rebuilds pendingQueue, sets promoting = false).
   */
  async promote(tmpPath: string, turboPath: string): Promise<void> {
    this.promoting = true;

    if (this.aborted) {
      this.promoting = false;
      return;
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
    this.ioWriteQueue = new IOWriteQueue(
      tmpPath,
      turboPath,
      this.stateManager,
      this.state.id,
      this.state.totalSize,
      (info) => { this.emit("turboMove", info); },
      (err) => { this.emit("turboHddError", err); },
    );

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

    // No in-flight chunks — complete promotion immediately
    if (this.activeCount === 0) {
      this.pendingQueue = this.state.chunks.filter(c => !c.completed);
      this.promoting = false;
      this.triggerTick?.();
      return;
    }

    // In-flight chunks are downloading — they'll finish via tick() and
    // complete the promotion when activeCount hits 0
    return new Promise<void>((resolve) => {
      this.promoteResolve = resolve;
    });
  }

  // ─── Turbo helpers ──────────────────────────────────────────────────────────

  updateMaxConnections(newMax: number): void {
    this.opts.maxConnections = newMax;
  }

  getTotalMovedBytes(): number {
    return this.ioWriteQueue?.getTotalMovedBytes() ?? 0;
  }

  /** Drain every queued chunk → .turbo, then stop. Used at download completion. */
  async drainIOWorker(): Promise<void> {
    if (this.ioWriteQueue) {
      await this.ioWriteQueue.drain();
      this.ioWriteQueue = null;
    }
  }

  /** Abort the IOWorker — finish the in-flight chunk, discard remaining queue. */
  async stopIOWorker(): Promise<void> {
    if (this.ioWriteQueue) {
      await this.ioWriteQueue.stop();
      this.ioWriteQueue = null;
    }
  }

  cleanupTurboFile(): void {
    if (this.turboPath && fs.existsSync(this.turboPath)) {
      try { fs.unlinkSync(this.turboPath); } catch {}
    }
  }

  isTurboHddSsd(): boolean {
    return this.turboPath !== null;
  }

  getTurboPath(): string | null {
    return this.turboPath;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private fallocate(fd: number, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.ftruncate(fd, size, err => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Pipeline: Raw bytes → Sliding Window → EMA → Stable Speed
   * Called from flushBuffers every WRITE_HIGH_WATER (8MB).
   */
  private updateSpeed(): void {
    const now = Date.now();

    // Record position sample into sliding window
    this.speedSamples.push({ timestamp: now, downloaded: this.totalDownloaded });

    // Prune samples older than the window
    const cutoff = now - SPEED_WINDOW_MS;
    while (this.speedSamples.length > 0 && this.speedSamples[0].timestamp < cutoff) {
      this.speedSamples.shift();
    }

    // Sliding window speed: (newest - oldest) / elapsed seconds
    if (this.speedSamples.length >= 2) {
      const oldest = this.speedSamples[0];
      const latest = this.speedSamples[this.speedSamples.length - 1];
      const elapsed = (latest.timestamp - oldest.timestamp) / 1000;
      if (elapsed > 0.5) {
        const windowSpeed = (latest.downloaded - oldest.downloaded) / elapsed;

        // Keep raw for backward compat / debugging
        this.bytesPerSecond = Math.round(windowSpeed);

        // EMA smooth the windowed speed
        this.smoothedSpeed = this.smoothedSpeed === 0
          ? windowSpeed
          : this.smoothedSpeed * (1 - SPEED_ALPHA) + windowSpeed * SPEED_ALPHA;
      }
    }
  }

  /** Raw instantaneous bytes/sec (volatile — for debug only). */
  getSpeed(): number { return this.bytesPerSecond; }

  /**
   * Stable speed via Sliding Window + EMA pipeline.
   * This is the value consumers should use for display and ETA computation.
   */
  getStableSpeed(): number {
    return Math.round(this.smoothedSpeed);
  }

  /**
   * Stable ETA via secondary EMA on top of smoothed-speed ETA.
   * Call this from the progress handler with total/downloaded bytes.
   */
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
    // Destroy the undici pool to abort all in-flight HTTP requests.
    // Otherwise a stuck downloadChunk (hanging HTTP stream) would never
    // check this.aborted, deadlocking the entire download.
    if (this.pool) {
      this.pool.destroy().catch(() => {});
    }
    // Stop IOWriteQueue gracefully
    if (this.ioWriteQueue) {
      this.ioWriteQueue.stop().catch(() => {});
    }
    // Resolve pending promote so promoteTask() doesn't hang
    if (this.promoteResolve) {
      this.promoteResolve();
      this.promoteResolve = null;
    }
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
