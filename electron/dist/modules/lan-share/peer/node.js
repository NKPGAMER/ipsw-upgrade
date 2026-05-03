"use strict";
/**
 * peer/node.ts
 *
 * PeerNode manages:
 *  - Local file registry (fileId → FileEntry)
 *  - Active upload/download counters
 *  - Coordinator registration and heartbeat loop
 *  - File server lifecycle
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
exports.PeerNode = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const http = __importStar(require("http"));
const crypto_1 = require("crypto");
const utils_1 = require("../shared/utils");
const file_server_1 = require("./file-server");
// ─── PeerNode ─────────────────────────────────────────────────────────────────
class PeerNode {
    nodeId;
    opts;
    files = new Map();
    _activeUploads = 0;
    _activeDownloads = 0;
    server = null;
    heartbeatTimer = null;
    port = 0;
    constructor(opts) {
        this.nodeId = opts.nodeId ?? (0, crypto_1.randomUUID)();
        this.opts = {
            ...opts,
            nodeId: this.nodeId,
            preferredPort: opts.preferredPort ?? 8800,
            announceIp: opts.announceIp ?? "",
        };
    }
    // ─── Lifecycle ─────────────────────────────────────────────────────────────
    async start() {
        this.port = await (0, utils_1.findFreePort)(this.opts.preferredPort);
        await this.scanFiles();
        const app = (0, file_server_1.createFileServer)(this);
        this.server = http.createServer(app);
        await new Promise((resolve, reject) => {
            this.server.listen(this.port, "0.0.0.0", resolve);
            this.server.once("error", reject);
        });
        console.log(`[PeerNode ${this.nodeId.slice(0, 8)}] File server on port ${this.port}`);
        console.log(`[PeerNode] Sharing ${this.files.size} file(s) from ${this.opts.shareDir}`);
        await this.register();
        this.startHeartbeat();
    }
    async stop() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.server) {
            await new Promise(resolve => this.server.close(() => resolve()));
            this.server = null;
        }
        console.log(`[PeerNode ${this.nodeId.slice(0, 8)}] Stopped`);
    }
    // ─── File scanning ─────────────────────────────────────────────────────────
    async scanFiles() {
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
                if (!stat.isFile())
                    continue;
                const fileId = await this.computeFileId(fullPath, stat.size);
                this.files.set(fileId, {
                    fileId,
                    name: entry,
                    size: stat.size,
                    path: fullPath,
                });
                console.log(`[PeerNode] Indexed: ${entry} (${(stat.size / 1024 ** 2).toFixed(1)} MB) → ${fileId.slice(0, 12)}`);
            }
            catch (err) {
                console.warn(`[PeerNode] Skipping ${entry}: ${err.message}`);
            }
        }
    }
    /**
     * Fast file ID: SHA-256 of (filename + filesize + first 64KB).
     * Avoids hashing the entire file for large files.
     */
    async computeFileId(filePath, size) {
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
            }
            finally {
                fs.closeSync(fd);
            }
        }
        return hash.digest("hex");
    }
    // ─── Coordinator integration ───────────────────────────────────────────────
    async register() {
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
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            console.log(`[PeerNode] Registered with coordinator at ${this.opts.coordinatorUrl}`);
        }
        catch (err) {
            console.error(`[PeerNode] Registration failed: ${err.message}`);
            throw err;
        }
    }
    startHeartbeat(intervalMs = 10_000) {
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
            }
            catch (err) {
                console.warn(`[PeerNode] Heartbeat failed: ${err.message}`);
            }
        }, intervalMs);
        this.heartbeatTimer.unref();
    }
    // ─── Accessors used by file-server ────────────────────────────────────────
    getFile(fileId) {
        return this.files.get(fileId);
    }
    findFileByName(name) {
        for (const entry of this.files.values()) {
            if (entry.name === name)
                return entry;
        }
        return undefined;
    }
    getFileCount() {
        return this.files.size;
    }
    getPeerInfo() {
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
    incrementUploads() { this._activeUploads++; }
    decrementUploads() { this._activeUploads = Math.max(0, this._activeUploads - 1); }
    incrementDownloads() { this._activeDownloads++; }
    decrementDownloads() { this._activeDownloads = Math.max(0, this._activeDownloads - 1); }
    async sendHeartbeatNow() {
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
    fileList() {
        return [...this.files.values()].map(({ path: _path, ...rest }) => rest);
    }
    async detectLocalIp() {
        const { networkInterfaces } = await Promise.resolve().then(() => __importStar(require("os")));
        const ifaces = networkInterfaces();
        for (const [, addrs] of Object.entries(ifaces)) {
            if (!addrs)
                continue;
            for (const addr of addrs) {
                if (addr.family === "IPv4" && !addr.internal)
                    return addr.address;
            }
        }
        return "127.0.0.1";
    }
}
exports.PeerNode = PeerNode;
