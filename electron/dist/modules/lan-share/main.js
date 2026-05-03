"use strict";
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
exports.formatSpeed = exports.formatBytes = exports.LANShare = void 0;
const http = __importStar(require("http"));
const node_1 = require("./peer/node");
const downloader_1 = require("./peer/downloader");
const server_1 = require("./coordinator/server");
// ─── Helpers ──────────────────────────────────────────────────────────────────
const HEALTH_SIGNATURE = "ipsw-manager";
/** Thử bind một port. Trả về server nếu thành công, null nếu EADDRINUSE. */
function tryBind(port) {
    return new Promise(resolve => {
        const srv = http.createServer();
        srv.once("error", () => resolve(null));
        srv.listen(port, "0.0.0.0", () => resolve(srv));
    });
}
/** Kiểm tra xem port đang chạy có phải ipsw-manager không. */
async function isIPSWManager(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/get-health`, {
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok)
            return false;
        const text = await res.text();
        return text.trim() === HEALTH_SIGNATURE;
    }
    catch {
        return false;
    }
}
// ─── LANShare ─────────────────────────────────────────────────────────────────
class LANShare {
    opts;
    node = null;
    coordinatorServer = null;
    coordinatorUrl = "";
    role = "peer";
    started = false;
    constructor(opts) {
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
    async start() {
        if (this.started)
            throw new Error("LANShare already started");
        const coordinatorPort = await this.electCoordinator();
        this.coordinatorUrl = `http://127.0.0.1:${coordinatorPort}`;
        this.node = new node_1.PeerNode({
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
    async electCoordinator() {
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
        throw new Error(`[LANShare] Could not find a free port or ipsw-manager in range ` +
            `${basePort}–${basePort + maxPortScan - 1}`);
    }
    /** Mount coordinator Express app lên server đã bind sẵn. */
    mountCoordinator(server, port) {
        const registry = new server_1.PeerRegistry();
        const app = (0, server_1.createCoordinatorApp)(registry);
        server.removeAllListeners("request");
        server.on("request", app);
        this.coordinatorServer = server;
        console.log(`[LANShare] Coordinator started on port ${port}`);
        return Promise.resolve();
    }
    // ─── Stop ───────────────────────────────────────────────────────────────────
    async stop() {
        if (this.node) {
            await this.node.stop();
            this.node = null;
        }
        if (this.coordinatorServer) {
            await new Promise(resolve => this.coordinatorServer.close(() => resolve()));
            this.coordinatorServer = null;
        }
        this.started = false;
        console.log("[LANShare] Stopped");
    }
    // ─── Download API ────────────────────────────────────────────────────────────
    async download(opts) {
        this.assertStarted();
        const downloader = new downloader_1.PeerDownloader(this.node);
        await downloader.download({
            coordinatorUrl: this.coordinatorUrl,
            ...opts,
        });
    }
    // ─── File discovery ──────────────────────────────────────────────────────────
    async findFile(fileId) {
        this.assertStarted();
        const res = await fetch(`${this.coordinatorUrl}/files/${fileId}`);
        if (!res.ok)
            return null;
        return res.json();
    }
    async listPeers() {
        this.assertStarted();
        const res = await fetch(`${this.coordinatorUrl}/peers`);
        return res.json();
    }
    async getPeerFiles(nodeId) {
        this.assertStarted();
        const res = await fetch(`${this.coordinatorUrl}/peers/${encodeURIComponent(nodeId)}/files`);
        if (!res.ok)
            return null;
        return res.json();
    }
    async getPeerDetail(nodeId) {
        this.assertStarted();
        const res = await fetch(`${this.coordinatorUrl}/peers/${encodeURIComponent(nodeId)}`);
        if (!res.ok)
            return null;
        return res.json();
    }
    async rescan() {
        this.assertStarted();
        await this.node.scanFiles();
        await this.node.sendHeartbeatNow();
    }
    async beginLocalDownload() {
        this.assertStarted();
        this.node.incrementDownloads();
        await this.node.sendHeartbeatNow();
    }
    async endLocalDownload() {
        this.assertStarted();
        this.node.decrementDownloads();
        await this.node.sendHeartbeatNow();
    }
    async notifyDownloadState() {
        this.assertStarted();
        await this.node.sendHeartbeatNow();
    }
    // ─── Status ─────────────────────────────────────────────────────────────────
    getStatus() {
        this.assertStarted();
        const info = this.node.getPeerInfo();
        return {
            role: this.role,
            coordinatorUrl: this.coordinatorUrl,
            peerPort: info.port,
            nodeId: this.node.nodeId,
            shareDir: this.opts.shareDir,
            fileCount: this.node.getFileCount(),
            storageType: info.storageType,
        };
    }
    get coordinatorEndpoint() { return this.coordinatorUrl; }
    get isCoordinator() { return this.role === "coordinator"; }
    assertStarted() {
        if (!this.started || !this.node)
            throw new Error("LANShare not started. Call start() first.");
    }
}
exports.LANShare = LANShare;
var utils_1 = require("./shared/utils");
Object.defineProperty(exports, "formatBytes", { enumerable: true, get: function () { return utils_1.formatBytes; } });
Object.defineProperty(exports, "formatSpeed", { enumerable: true, get: function () { return utils_1.formatSpeed; } });
