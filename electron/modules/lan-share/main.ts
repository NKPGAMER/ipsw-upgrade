/**
 * lan-share/main.ts
 *
 * Mọi máy chạy cùng logic khởi động:
 *
 *  1. Thử bind PORT (mặc định 8700).
 *     - Bind được → máy này là coordinator, start luôn.
 *     - EADDRINUSE → port bị chiếm, kiểm tra `/get-health` xem có phải
 *       ipsw-manager không. Nếu đúng → join làm peer. Nếu sai (app khác
 *       đang dùng port đó) → thử port tiếp theo, lặp lại.
 *
 *  2. Sau khi xác định coordinatorUrl, khởi tạo PeerNode và đăng ký.
 *
 * Usage trong Electron main process:
 *
 *   import { LANShare } from "./lan-share/main";
 *
 *   const lan = new LANShare({
 *     shareDir: path.join(app.getPath("userData"), "shared"),
 *     storageType: "SSD",
 *   });
 *
 *   const status = await lan.start();
 *   app.on("before-quit", () => lan.stop());
 */

import * as http from "http";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { PeerNode } from "./peer/node";
import { PeerDownloader } from "./peer/downloader";
import type { ProgressInfo } from "./peer/downloader";
import { createCoordinatorApp, PeerRegistry } from "./coordinator/server";
import { formatBytes, formatSpeed } from "./shared/utils";
import type { StorageType } from "./shared/types";
import type { StateManager } from "../downloader/state-manager";
import type { DownloadState } from "../downloader/types";

// Lazy import to avoid circular dependency at module load
let DownloaderMain: any;
function getDownloaderMain() {
  if (!DownloaderMain) {
    try { DownloaderMain = require("../downloader/downloader-main").DownloaderMain; } catch {}
  }
  return DownloaderMain;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LANShareOptions {
  shareDir: string;
  storageType: StorageType;

  /**
   * Port đầu tiên được thử. Nếu bị chiếm bởi app khác (không phải
   * ipsw-manager) sẽ tự động thử port+1, port+2, ... cho đến maxPortScan.
   * Mặc định: 8700
   */
  basePort?: number;

  /** Số port tối đa được scan. Mặc định: 20 */
  maxPortScan?: number;

  /** IP để announce với coordinator (tự detect nếu bỏ trống) */
  announceIp?: string;

  /** Port cho peer file-server. Mặc định: 8800 */
  peerPort?: number;

  /** StateManager instance for persisting download state (same dir as main downloader) */
  stateManager?: StateManager;
}

export interface LANShareStatus {
  role: "coordinator" | "peer";
  coordinatorUrl: string;
  peerPort: number;
  nodeId: string;
  shareDir: string;
  fileCount: number;
  storageType: StorageType;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEALTH_SIGNATURE = "ipsw-manager";

/** Thử bind một port. Trả về server nếu thành công, null nếu EADDRINUSE. */
function tryBind(port: number): Promise<http.Server | null> {
  return new Promise(resolve => {
    const srv = http.createServer();
    srv.once("error", () => resolve(null));
    srv.listen(port, "0.0.0.0", () => resolve(srv));
  });
}

/** Kiểm tra một host:port có phải ipsw-manager không. */
async function isIPSWManagerAt(host: string, port: number, timeout = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/get-health`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trim() === HEALTH_SIGNATURE;
  } catch {
    return false;
  }
}

/** Kiểm tra localhost. */
async function isIPSWManager(port: number): Promise<boolean> {
  return isIPSWManagerAt("127.0.0.1", port);
}

/**
 * Lấy danh sách địa chỉ IPv4 nội bộ (không loopback).
 * Trả về mảng { address, subnetBase } — subnetBase là 3 octet đầu
 * (vd: 192.168.1).
 */
function getLocalSubnets(): { address: string; subnetBase: string }[] {
  const results: { address: string; subnetBase: string }[] = [];
  const nets = os.networkInterfaces();
  for (const [_name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const iface of addrs) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const octets = iface.address.split(".");
      if (octets.length !== 4) continue;
      results.push({
        address: iface.address,
        subnetBase: octets.slice(0, 3).join("."),
      });
    }
  }
  return results;
}

/**
 * Quét LAN để tìm ipsw-manager coordinator.
 * Chỉ scan basePort — coordinator luôn dùng port đầu tiên khả dụng.
 * Scan tất cả IP (1–254) trong subnet với concurrency cao.
 */
async function findCoordinatorOnLAN(
  basePort: number,
  _maxPortScan?: number,
  probeTimeout = 500
): Promise<{ host: string; port: number } | null> {
  const subnets = getLocalSubnets();
  if (subnets.length === 0) return null;

  const myIPs = new Set(subnets.map(s => s.address));

  for (const { subnetBase } of subnets) {
    // Tạo danh sách IP, bỏ qua IP của chính máy này
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnetBase}.${i}`;
      if (!myIPs.has(ip)) ips.push(ip);
    }

    // Scan theo batch 50 IP cùng lúc để tăng tốc
    const BATCH = 50;
    for (let batchStart = 0; batchStart < ips.length; batchStart += BATCH) {
      const batch = ips.slice(batchStart, batchStart + BATCH);
      const results = await Promise.all(
        batch.map(async ip => {
          const ok = await isIPSWManagerAt(ip, basePort, probeTimeout);
          return ok ? ip : null;
        })
      );
      const found = results.find(r => r !== null);
      if (found) {
        return { host: found, port: basePort };
      }
    }
  }

  return null;
}

// ─── LANShare ─────────────────────────────────────────────────────────────────

export class LANShare extends EventEmitter {
  private opts: Required<LANShareOptions>;
  private node: PeerNode | null = null;
  private coordinatorServer: http.Server | null = null;
  private coordinatorUrl = "";
  private role: "coordinator" | "peer" = "peer";
  private started = false;
  private downloaderRef: any = null;
  private activeLanDownloads = new Map<string, PeerDownloader>();

  constructor(opts: LANShareOptions) {
    super();
    this.opts = {
      shareDir: opts.shareDir,
      storageType: opts.storageType,
      basePort: opts.basePort ?? 8700,
      maxPortScan: opts.maxPortScan ?? 20,
      announceIp: opts.announceIp ?? "",
      peerPort: opts.peerPort ?? 8800,
      stateManager: opts.stateManager as StateManager,
    };
  }

  // ─── Start ──────────────────────────────────────────────────────────────────

  async start(): Promise<LANShareStatus> {
    if (this.started) throw new Error("LANShare already started");

    const coordinatorPort = await this.electCoordinator();
    // Only set localhost URL if electCoordinator didn't already set a remote one
    if (!this.coordinatorUrl) {
      this.coordinatorUrl = `http://127.0.0.1:${coordinatorPort}`;
    }

    this.node = new PeerNode({
      coordinatorUrl: this.coordinatorUrl,
      shareDir: this.opts.shareDir,
      storageType: this.opts.storageType,
      preferredPort: this.opts.peerPort,
      announceIp: this.opts.announceIp || undefined,
    });

    await this.node.start();
    this.started = true;

    console.log(`[LANShare] Started as ${this.role} → coordinator at ${this.coordinatorUrl}`);
    return this.getStatus();
  }

  // ─── Coordinator election ────────────────────────────────────────────────────

  /**
   * Election flow (local + LAN):
   *
   *  1. Thử bind từng port trong range.
   *  2. Nếu port bị chiếm cục bộ + /get-health = "ipsw-manager" → join làm peer.
   *  3. Nếu port bị chiếm bởi app khác → thử port kế.
   *  4. Nếu bind thành công → quét LAN tìm coordinator có sẵn:
   *     a. Có coordinator trên LAN → hủy bind, join làm peer trỏ đến IP đó.
   *     b. Không có → máy này làm coordinator.
   */
  private async electCoordinator(): Promise<number> {
    const { basePort, maxPortScan } = this.opts;

    for (let delta = 0; delta < maxPortScan; delta++) {
      const port = basePort + delta;

      const bound = await tryBind(port);

      if (bound) {
        // Bind thành công — nhưng trước khi làm coordinator, quét LAN
        console.log(`[LANShare] Bound port ${port}, scanning LAN for existing coordinator...`);
        const existing = await findCoordinatorOnLAN(basePort, maxPortScan, 1000);

        if (existing) {
          // Có coordinator trên LAN → hủy bind, join làm peer
          console.log(`[LANShare] Found coordinator on LAN at ${existing.host}:${existing.port}, joining as peer`);
          await new Promise<void>(resolve => bound.close(() => resolve()));
          this.role = "peer";
          this.coordinatorUrl = `http://${existing.host}:${existing.port}`;
          return existing.port;
        }

        // Không có coordinator trên LAN → máy này làm coordinator
        await this.mountCoordinator(bound, port);
        this.role = "coordinator";
        return port;
      }

      // Port bị chiếm cục bộ — kiểm tra có phải ipsw-manager không
      const valid = await isIPSWManager(port);
      if (valid) {
        this.role = "peer";
        console.log(`[LANShare] Found local coordinator at port ${port}, joining as peer`);
        return port;
      }

      // Port bị app khác chiếm → thử tiếp
      console.log(`[LANShare] Port ${port} occupied by unknown app, trying ${port + 1}...`);
    }

    throw new Error(
      `[LANShare] Could not find a free port or ipsw-manager in range ` +
      `${basePort}–${basePort + maxPortScan - 1}`
    );
  }

  /** Mount coordinator Express app lên server đã bind sẵn. */
  private mountCoordinator(server: http.Server, port: number): Promise<void> {
    const registry = new PeerRegistry();
    const app = createCoordinatorApp(registry);

    server.removeAllListeners("request");
    server.on("request", app);

    this.coordinatorServer = server;
    console.log(`[LANShare] Coordinator started on port ${port}`);
    return Promise.resolve();
  }

  // ─── Stop ───────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
    if (this.coordinatorServer) {
      await new Promise<void>(resolve => this.coordinatorServer!.close(() => resolve()));
      this.coordinatorServer = null;
    }
    this.started = false;
    console.log("[LANShare] Stopped");
  }

  // ─── Downloader reference ──────────────────────────────────────────────────

  setDownloader(dl: any): void {
    this.downloaderRef = dl;
  }

  // ─── Download API ────────────────────────────────────────────────────────────

  async download(opts: {
    fileId: string;
    fileName: string;
    fileSize: number;
    firmware: Firmware;
    firmwareUrl: string;
    savePath: string;
    tmpDir: string;
    maxConcurrentChunks?: number;
    onProgress?: (info: ProgressInfo) => void;
  }): Promise<{ success: boolean; via: "lan" | "cdn"; downloadId: string; error?: string }> {
    this.assertStarted();

    const downloadId = randomUUID();
    const tmpPath = path.join(opts.tmpDir, `${downloadId}.ipsw.tmp`);
    const sm = this.opts.stateManager;

    // Build initial DownloadState (compatible with main downloader)
    if (sm) {
      const state: DownloadState = {
        id: downloadId,
        firmware: opts.firmware,
        savePath: opts.savePath,
        tmpPath,
        totalSize: opts.fileSize,
        chunks: [], // populated after chunk plan is built
        supportsRanges: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      sm.save(state);
    }

    const progressWithSource = (info: ProgressInfo) => {
      opts.onProgress?.({ ...info, source: "lan" });
    };

    // Attempt LAN download
    const downloader = new PeerDownloader(this.node!);
    this.activeLanDownloads.set(downloadId, downloader);

    try {
      await downloader.download({
        coordinatorUrl: this.coordinatorUrl,
        fileId: opts.fileId,
        fileName: opts.fileName,
        fileSize: opts.fileSize,
        outputPath: tmpPath,
        maxConcurrentChunks: opts.maxConcurrentChunks,
        stateManager: sm,
        downloadId,
        onProgress: progressWithSource,
      });

      // LAN download succeeded
      this.activeLanDownloads.delete(downloadId);

      // Move tmp file to final destination
      const fs = await import("fs");
      const finalPath = path.join(
        opts.savePath,
        opts.fileName || opts.firmware.url.split("/").pop() || `${opts.firmware.identifier}_${opts.firmware.buildid}.ipsw`
      );
      const destDir = path.dirname(finalPath);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      try {
        fs.renameSync(tmpPath, finalPath);
      } catch {
        fs.copyFileSync(tmpPath, finalPath);
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      // Clean up state
      sm?.delete(downloadId);

      opts.onProgress?.({
        downloaded: opts.fileSize,
        total: opts.fileSize,
        pct: 100,
        speed: 0,
        activeChunks: 0,
        source: "lan",
      });

      return { success: true, via: "lan", downloadId };
    } catch (err: any) {
      this.activeLanDownloads.delete(downloadId);
      console.warn(`[LANShare] LAN download failed: ${err.message}`);

      // Check if we have any partial progress
      const state = sm?.load(downloadId);
      const hasProgress = state && state.chunks.some(c => c.completed || c.downloaded > 0);

      if (!hasProgress) {
        // No progress — clean up and fall back to CDN fresh download
        sm?.delete(downloadId);
        try { (await import("fs")).unlinkSync(tmpPath); } catch {}

        if (this.downloaderRef?.add) {
          const result = await this.downloaderRef.add(opts.firmware, opts.savePath);
          if (result?.success) {
            opts.onProgress?.({ downloaded: 0, total: opts.fileSize, pct: 0, speed: 0, activeChunks: 0, source: "cdn" });
            return { success: true, via: "cdn", downloadId: result.id };
          }
          return { success: false, via: "cdn", downloadId: "", error: result?.error || "CDN add failed" };
        }

        return { success: false, via: "lan", downloadId: "", error: `No LAN peers and no CDN fallback: ${err.message}` };
      }

      // Partial progress — resume via CDN using saved state
      if (this.downloaderRef?.resumeIncomplete) {
        const result = await this.downloaderRef.resumeIncomplete(downloadId);
        if (result?.success) {
          this.emit("fallback-to-cdn", downloadId);
          opts.onProgress?.({ downloaded: 0, total: opts.fileSize, pct: 0, speed: 0, activeChunks: 0, source: "cdn" });
          return { success: true, via: "cdn", downloadId };
        }
        return { success: false, via: "cdn", downloadId, error: result?.error || "CDN resume failed" };
      }

      return { success: false, via: "lan", downloadId, error: `Partial download but no CDN fallback: ${err.message}` };
    }
  }

  cancelDownload(downloadId: string): { success: boolean; error?: string } {
    const downloader = this.activeLanDownloads.get(downloadId);
    if (downloader) {
      // PeerDownloader doesn't have explicit cancel — the promise will reject
      this.activeLanDownloads.delete(downloadId);
      const sm = this.opts.stateManager;
      sm?.delete(downloadId);
      return { success: true };
    }
    return { success: false, error: "Download not found" };
  }

  // ─── File discovery ──────────────────────────────────────────────────────────

  async findFile(fileId: string) {
    this.assertStarted();
    const res = await fetch(`${this.coordinatorUrl}/files/${fileId}`);
    if (!res.ok) return null;
    return res.json();
  }

  async listPeers() {
    this.assertStarted();
    const res = await fetch(`${this.coordinatorUrl}/peers`);
    return res.json();
  }

  async getPeerFiles(nodeId: string) {
    this.assertStarted();
    const res = await fetch(`${this.coordinatorUrl}/peers/${encodeURIComponent(nodeId)}/files`);
    if (!res.ok) return null;
    return res.json();
  }

  async getPeerDetail(nodeId: string) {
    this.assertStarted();
    const res = await fetch(`${this.coordinatorUrl}/peers/${encodeURIComponent(nodeId)}`);
    if (!res.ok) return null;
    return res.json();
  }

  async rescan(): Promise<void> {
    this.assertStarted();
    await this.node!.scanFiles();
    await this.node!.sendHeartbeatNow();
  }

  async beginLocalDownload(): Promise<void> {
    this.assertStarted();
    this.node!.incrementDownloads();
    await this.node!.sendHeartbeatNow();
  }

  async endLocalDownload(): Promise<void> {
    this.assertStarted();
    this.node!.decrementDownloads();
    await this.node!.sendHeartbeatNow();
  }

  async notifyDownloadState(): Promise<void> {
    this.assertStarted();
    await this.node!.sendHeartbeatNow();
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  getStatus(): LANShareStatus {
    this.assertStarted();
    const info = this.node!.getPeerInfo();
    return {
      role: this.role,
      coordinatorUrl: this.coordinatorUrl,
      peerPort: info.port,
      nodeId: this.node!.nodeId,
      shareDir: this.opts.shareDir,
      fileCount: this.node!.getFileCount(),
      storageType: info.storageType,
    };
  }

  get coordinatorEndpoint(): string { return this.coordinatorUrl; }
  get isCoordinator(): boolean { return this.role === "coordinator"; }

  private assertStarted(): void {
    if (!this.started || !this.node) throw new Error("LANShare not started. Call start() first.");
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { StorageType, FileLocation, CanServeResponse } from "./shared/types";
export { formatBytes, formatSpeed } from "./shared/utils";