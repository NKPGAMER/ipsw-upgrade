/**
 * peer/node.ts
 *
 * PeerNode manages:
 *  - Local file registry (fileId → FileEntry)
 *  - Active upload/download counters
 *  - Coordinator registration and heartbeat loop
 *  - File server lifecycle
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as http from "http";
import { randomUUID } from "crypto";
import type { FileEntry, PeerInfo, StorageType } from "../shared/types";
import { findFreePort } from "../shared/utils";
import { createFileServer } from "./file-server";

export interface PeerNodeOptions {
  coordinatorUrl: string;   // e.g. http://192.168.1.10:8700
  shareDir: string;         // directory to share
  storageType: StorageType;
  preferredPort?: number;
  nodeId?: string;           // auto-generated if omitted
  announceIp?: string;       // override auto-detected IP
}

// ─── PeerNode ─────────────────────────────────────────────────────────────────

export class PeerNode {
  readonly nodeId: string;
  private opts: Required<PeerNodeOptions>;

  private files = new Map<string, FileEntry>();
  private _activeUploads = 0;
  private _activeDownloads = 0;

  private server: http.Server | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private port = 0;

  constructor(opts: PeerNodeOptions) {
    this.nodeId = opts.nodeId ?? randomUUID();
    this.opts = {
      ...opts,
      nodeId: this.nodeId,
      preferredPort: opts.preferredPort ?? 8800,
      announceIp: opts.announceIp ?? "",
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.port = await findFreePort(this.opts.preferredPort);
    await this.scanFiles();

    const app = createFileServer(this);
    this.server = http.createServer(app);

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "0.0.0.0", resolve);
      this.server!.once("error", reject);
    });

    console.log(`[PeerNode ${this.nodeId.slice(0, 8)}] File server on port ${this.port}`);
    console.log(`[PeerNode] Sharing ${this.files.size} file(s) from ${this.opts.shareDir}`);

    await this.register();
    this.startHeartbeat();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.server) {
      await new Promise<void>(resolve => this.server!.close(() => resolve()));
      this.server = null;
    }
    console.log(`[PeerNode ${this.nodeId.slice(0, 8)}] Stopped`);
  }

  // ─── File scanning ─────────────────────────────────────────────────────────

  async scanFiles(): Promise<void> {
    this.files.clear();
    const dir = this.opts.shareDir;

    if (!fs.existsSync(dir)) {
      console.warn(`[PeerNode] Share dir does not exist: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        const fileId = await this.computeFileId(fullPath, stat.size);
        this.files.set(fileId, {
          fileId,
          name: entry,
          size: stat.size,
          path: fullPath,
        });
        console.log(`[PeerNode] Indexed: ${entry} (${(stat.size / 1024 ** 2).toFixed(1)} MB) → ${fileId.slice(0, 12)}`);
      } catch (err: any) {
        console.warn(`[PeerNode] Skipping ${entry}: ${err.message}`);
      }
    }
  }

  /**
   * Fast file ID: SHA-256 of (filename + filesize + first 64KB).
   * Avoids hashing the entire file for large files.
   */
  private async computeFileId(filePath: string, size: number): Promise<string> {
    const name = path.basename(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(`${name}:${size}:`);

    // Mix in first 64 KB for content fingerprint
    const SAMPLE = 64 * 1024;
    if (size > 0) {
      const fd = fs.openSync(filePath, "r");
      try {
        const buf = Buffer.allocUnsafe(Math.min(SAMPLE, size));
        fs.readSync(fd, buf, 0, buf.length, 0);
        hash.update(buf);
      } finally {
        fs.closeSync(fd);
      }
    }

    return hash.digest("hex");
  }

  // ─── Coordinator integration ───────────────────────────────────────────────

  private async register(): Promise<void> {
    const ip = this.opts.announceIp || (await this.detectLocalIp());
    const body = {
      nodeId: this.nodeId,
      ip,
      port: this.port,
      storageType: this.opts.storageType,
      files: this.fileList(),
    };

    try {
      const res = await fetch(`${this.opts.coordinatorUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`[PeerNode] Registered with coordinator at ${this.opts.coordinatorUrl}`);
    } catch (err: any) {
      console.error(`[PeerNode] Registration failed: ${err.message}`);
      throw err;
    }
  }

  private startHeartbeat(intervalMs = 10_000): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.opts.coordinatorUrl}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: this.nodeId,
            activeUploads: this._activeUploads,
            activeDownloads: this._activeDownloads,
          }),
        });
        if (res.status === 404) {
          // Coordinator restarted — re-register
          console.warn("[PeerNode] Coordinator lost us — re-registering...");
          await this.register();
        }
      } catch (err: any) {
        console.warn(`[PeerNode] Heartbeat failed: ${err.message}`);
      }
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  // ─── Accessors used by file-server ────────────────────────────────────────

  getFile(fileId: string): FileEntry | undefined {
    return this.files.get(fileId);
  }

  getFileCount(): number {
    return this.files.size;
  }

  getPeerInfo(): PeerInfo {
    return {
      nodeId: this.nodeId,
      ip: "",
      port: this.port,
      storageType: this.opts.storageType,
      activeUploads: this._activeUploads,
      activeDownloads: this._activeDownloads,
      lastSeen: Date.now(),
    };
  }

  incrementUploads(): void { this._activeUploads++; }
  decrementUploads(): void { this._activeUploads = Math.max(0, this._activeUploads - 1); }
  incrementDownloads(): void { this._activeDownloads++; }
  decrementDownloads(): void { this._activeDownloads = Math.max(0, this._activeDownloads - 1); }

  async sendHeartbeatNow(): Promise<void> {
    await fetch(`${this.opts.coordinatorUrl}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: this.nodeId,
        activeUploads: this._activeUploads,
        activeDownloads: this._activeDownloads,
        files: this.fileList(),
      }),
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private fileList() {
    return [...this.files.values()].map(({ path: _path, ...rest }) => rest);
  }

  private async detectLocalIp(): Promise<string> {
    const { networkInterfaces } = await import("os");
    const ifaces = networkInterfaces();
    for (const [, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
      }
    }
    return "127.0.0.1";
  }
}
