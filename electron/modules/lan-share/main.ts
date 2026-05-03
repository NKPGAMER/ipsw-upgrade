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
import { PeerNode } from "./peer/node";
import { PeerDownloader } from "./peer/downloader";
import { createCoordinatorApp, PeerRegistry } from "./coordinator/server";
import { formatBytes, formatSpeed } from "./shared/utils";
import type { StorageType } from "./shared/types";

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

/** Kiểm tra xem port đang chạy có phải ipsw-manager không. */
async function isIPSWManager(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/get-health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trim() === HEALTH_SIGNATURE;
  } catch {
    return false;
  }
}

// ─── LANShare ─────────────────────────────────────────────────────────────────

export class LANShare {
  private opts: Required<LANShareOptions>;
  private node: PeerNode | null = null;
  private coordinatorServer: http.Server | null = null;
  private coordinatorUrl = "";
  private role: "coordinator" | "peer" = "peer";
  private started = false;

  constructor(opts: LANShareOptions) {
    this.opts = {
      shareDir: opts.shareDir,
      storageType: opts.storageType,
      basePort: opts.basePort ?? 8700,
      maxPortScan: opts.maxPortScan ?? 20,
      announceIp: opts.announceIp ?? "",
      peerPort: opts.peerPort ?? 8800,
    };
  }

  // ─── Start ──────────────────────────────────────────────────────────────────

  async start(): Promise<LANShareStatus> {
    if (this.started) throw new Error("LANShare already started");

    const coordinatorPort = await this.electCoordinator();
    this.coordinatorUrl = `http://127.0.0.1:${coordinatorPort}`;

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
   * Scan ports bắt đầu từ basePort:
   *
   *  - Port trống → bind, mount coordinator app, trả về port.
   *  - Port bị chiếm + /get-health trả về "ipsw-manager" → join, trả về port.
   *  - Port bị chiếm + không phải ipsw-manager → thử port kế tiếp.
   */
  private async electCoordinator(): Promise<number> {
    const { basePort, maxPortScan } = this.opts;

    for (let delta = 0; delta < maxPortScan; delta++) {
      const port = basePort + delta;

      const bound = await tryBind(port);

      if (bound) {
        // Bind thành công → máy này là coordinator
        await this.mountCoordinator(bound, port);
        this.role = "coordinator";
        return port;
      }

      // Port bị chiếm — kiểm tra xem có phải ipsw-manager không
      const valid = await isIPSWManager(port);
      if (valid) {
        this.role = "peer";
        console.log(`[LANShare] Found coordinator at port ${port}, joining as peer`);
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

  // ─── Download API ────────────────────────────────────────────────────────────

  async download(opts: {
    fileId: string;
    fileName: string;
    fileSize: number;
    firmwareUrl: string;        // Apple CDN URL — dùng khi LAN không có
    outputPath: string;
    maxConcurrentChunks?: number;
    onProgress?: (info: import("./peer/downloader").ProgressInfo) => void;
  }): Promise<void> {
    this.assertStarted();
    const downloader = new PeerDownloader(this.node!);
    await downloader.download({
      coordinatorUrl: this.coordinatorUrl,
      ...opts,
    });
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