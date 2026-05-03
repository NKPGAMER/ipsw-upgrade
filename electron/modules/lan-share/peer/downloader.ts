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

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { URL } from "url";
import type { FileLocation, ChunkPlan, CanServeResponse } from "../shared/types";
import { buildChunkPlan, rankCandidates, formatBytes, formatSpeed } from "../shared/utils";
import type { PeerNode } from "./node";

export interface DownloadOptions {
  coordinatorUrl: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  outputPath: string;
  maxConcurrentChunks?: number;
  chunkSize?: number;
  onProgress?: (info: ProgressInfo) => void;
}

export interface ProgressInfo {
  downloaded: number;
  total: number;
  pct: number;
  speed: number;    // bytes/s
  eta?: number;     // seconds
  activeChunks: number;
  source?: "lan" | "apple";
}

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;   // 32 MB
const DEFAULT_CONCURRENCY = 6;
const WRITE_BUFFER_SIZE = 512 * 1024;          // 512 KB write buffer per chunk

// ─── Downloader ───────────────────────────────────────────────────────────────

export class PeerDownloader {
  private node?: PeerNode;

  constructor(node?: PeerNode) {
    this.node = node;
  }

  /**
   * Full download flow:
   * 1. Query coordinator for peers with this file
   * 2. Probe peers for capacity
   * 3. Build chunk plan
   * 4. Download in parallel
   */
  async download(opts: DownloadOptions): Promise<void> {
    this.node?.incrementDownloads();

    try {
      // Step 1: Query coordinator
      const locations = await this.queryCoordinator(opts.coordinatorUrl, opts.fileId);
      if (locations.length === 0) throw new Error("No peers have this file");

      // Step 2: Probe peers and get live capacity
      const probed = await this.probePeers(locations);
      if (probed.length === 0) throw new Error("All peers are busy or unreachable");

      console.log(`[Downloader] ${probed.length} peers available for ${opts.fileName}`);

      // Step 3: Build chunk plan
      const chunks = buildChunkPlan(opts.fileSize, probed, opts.chunkSize ?? DEFAULT_CHUNK_SIZE);
      console.log(`[Downloader] ${chunks.length} chunks across ${probed.length} peers`);

      // Step 4: Allocate output file
      await this.allocateFile(opts.outputPath, opts.fileSize);

      // Step 5: Download
      await this.downloadChunks(chunks, opts, probed);

    } finally {
      this.node?.decrementDownloads();
    }
  }

  // ─── Coordinator query ─────────────────────────────────────────────────────

  private async queryCoordinator(coordinatorUrl: string, fileId: string): Promise<FileLocation[]> {
    const res = await fetch(`${coordinatorUrl}/files/${fileId}`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Coordinator error: HTTP ${res.status}`);
    const data = await res.json() as { locations: FileLocation[] };
    return data.locations ?? [];
  }

  // ─── Peer probing ──────────────────────────────────────────────────────────

  private async probePeers(locations: FileLocation[]): Promise<FileLocation[]> {
    const results = await Promise.allSettled(
      locations.map(loc => this.probePeer(loc))
    );

    const available: FileLocation[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value) {
        available.push(locations[i]);
      }
    }

    return rankCandidates(available);
  }

  private async probePeer(loc: FileLocation): Promise<boolean> {
    try {
      const res = await fetch(`http://${loc.ip}:${loc.port}/can-serve`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json() as CanServeResponse;
      return data.status === "ACCEPT";
    } catch {
      return false;
    }
  }

  // ─── File allocation ───────────────────────────────────────────────────────

  private async allocateFile(outputPath: string, size: number): Promise<void> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Pre-allocate with ftruncate to avoid fragmentation
    const fd = fs.openSync(outputPath, "w");
    try {
      await new Promise<void>((res, rej) =>
        fs.ftruncate(fd, size, e => (e ? rej(e) : res()))
      );
    } finally {
      fs.closeSync(fd);
    }
  }

  // ─── Parallel chunk download ───────────────────────────────────────────────

  private async downloadChunks(
    chunks: ChunkPlan[],
    opts: DownloadOptions,
    allPeers: FileLocation[]
  ): Promise<void> {
    const concurrency = opts.maxConcurrentChunks ?? DEFAULT_CONCURRENCY;
    const totalBytes = opts.fileSize;
    let downloadedBytes = 0;
    let activeChunks = 0;
    const startedAt = Date.now();

    // Open file for random-access write
    const fd = fs.openSync(opts.outputPath, "r+");

    try {
      await new Promise<void>((resolve, reject) => {
        const queue = [...chunks];
        let inFlight = 0;
        let failed = 0;

        const dispatch = () => {
          while (inFlight < concurrency && queue.length > 0) {
            const chunk = queue.shift()!;
            inFlight++;
            activeChunks++;

            this.downloadChunk(chunk, opts.fileId, fd, allPeers)
              .then(bytes => {
                downloadedBytes += bytes;
                inFlight--;
                activeChunks--;

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
                  });
                }

                if (inFlight === 0 && queue.length === 0) resolve();
                else dispatch();
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
        if (chunks.length === 0) resolve();
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  // ─── Single chunk download ─────────────────────────────────────────────────

  private async downloadChunk(
    chunk: ChunkPlan,
    fileId: string,
    fd: number,
    fallbacks: FileLocation[],
    attempt = 0
  ): Promise<number> {
    const url = `http://${chunk.ip}:${chunk.port}/file/${fileId}`;
    const rangeHeader = `bytes=${chunk.rangeStart}-${chunk.rangeEnd}`;
    const expectedBytes = chunk.rangeEnd - chunk.rangeStart + 1;

    try {
      const bytesWritten = await this.streamChunkToFile(url, rangeHeader, fd, chunk.rangeStart);

      if (bytesWritten !== expectedBytes) {
        throw new Error(`Expected ${expectedBytes} bytes, got ${bytesWritten}`);
      }

      return bytesWritten;
    } catch (err: any) {
      if (attempt < 2) {
        // Try a different peer for this chunk
        const alt = fallbacks.find(p =>
          !(p.ip === chunk.ip && p.port === chunk.port)
        );
        if (alt) {
          console.warn(`[Downloader] Retrying chunk on ${alt.ip}:${alt.port}`);
          return this.downloadChunk(
            { ...chunk, ip: alt.ip, port: alt.port, nodeId: alt.nodeId },
            fileId, fd, fallbacks, attempt + 1
          );
        }
      }
      throw new Error(`Chunk ${chunk.rangeStart}-${chunk.rangeEnd} failed: ${err.message}`);
    }
  }

  private streamChunkToFile(
    url: string,
    rangeHeader: string,
    fd: number,
    writeOffset: number
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options: http.RequestOptions = {
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
        const buffers: Buffer[] = [];
        let bufferedBytes = 0;

        const flushToFile = (final = false): Promise<void> => {
          if (buffers.length === 0) return Promise.resolve();

          const combined = Buffer.concat(buffers);
          buffers.length = 0;
          bufferedBytes = 0;

          return new Promise((res2, rej2) => {
            fs.write(fd, combined, 0, combined.length, position, (err, written) => {
              if (err) { rej2(err); return; }
              position += written;
              totalWritten += written;
              res2();
            });
          });
        };

        const processChunk = async (chunk: Buffer) => {
          buffers.push(chunk);
          bufferedBytes += chunk.length;
          if (bufferedBytes >= WRITE_BUFFER_SIZE) {
            await flushToFile();
          }
        };

        res.on("data", (chunk: Buffer) => {
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
