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
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const events_1 = require("events");
const crypto_1 = require("crypto");
const node_1 = require("./peer/node");
const downloader_1 = require("./peer/downloader");
const server_1 = require("./coordinator/server");
// Lazy import to avoid circular dependency at module load
let DownloaderMain;
function getDownloaderMain() {
    if (!DownloaderMain) {
        try {
            DownloaderMain = require("../downloader/downloader-main").DownloaderMain;
        }
        catch { }
    }
    return DownloaderMain;
}
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
/** Kiểm tra một host:port có phải ipsw-manager không. */
async function isIPSWManagerAt(host, port, timeout = 2000) {
    try {
        const res = await fetch(`http://${host}:${port}/get-health`, {
            signal: AbortSignal.timeout(timeout),
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
/** Kiểm tra localhost. */
async function isIPSWManager(port) {
    return isIPSWManagerAt("127.0.0.1", port);
}
/**
 * Lấy danh sách địa chỉ IPv4 nội bộ (không loopback).
 * Trả về mảng { address, subnetBase } — subnetBase là 3 octet đầu
 * (vd: 192.168.1).
 */
function getLocalSubnets() {
    const results = [];
    const nets = os.networkInterfaces();
    for (const [_name, addrs] of Object.entries(nets)) {
        if (!addrs)
            continue;
        for (const iface of addrs) {
            if (iface.family !== "IPv4" || iface.internal)
                continue;
            const octets = iface.address.split(".");
            if (octets.length !== 4)
                continue;
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
async function findCoordinatorOnLAN(basePort, _maxPortScan, probeTimeout = 500) {
    const subnets = getLocalSubnets();
    if (subnets.length === 0)
        return null;
    const myIPs = new Set(subnets.map(s => s.address));
    for (const { subnetBase } of subnets) {
        // Tạo danh sách IP, bỏ qua IP của chính máy này
        const ips = [];
        for (let i = 1; i <= 254; i++) {
            const ip = `${subnetBase}.${i}`;
            if (!myIPs.has(ip))
                ips.push(ip);
        }
        // Scan theo batch 50 IP cùng lúc để tăng tốc
        const BATCH = 50;
        for (let batchStart = 0; batchStart < ips.length; batchStart += BATCH) {
            const batch = ips.slice(batchStart, batchStart + BATCH);
            const results = await Promise.all(batch.map(async (ip) => {
                const ok = await isIPSWManagerAt(ip, basePort, probeTimeout);
                return ok ? ip : null;
            }));
            const found = results.find(r => r !== null);
            if (found) {
                return { host: found, port: basePort };
            }
        }
    }
    return null;
}
// ─── LANShare ─────────────────────────────────────────────────────────────────
class LANShare extends events_1.EventEmitter {
    opts;
    node = null;
    coordinatorServer = null;
    coordinatorUrl = "";
    role = "peer";
    started = false;
    downloaderRef = null;
    activeLanDownloads = new Map();
    constructor(opts) {
        super();
        this.opts = {
            shareDir: opts.shareDir,
            storageType: opts.storageType,
            basePort: opts.basePort ?? 8700,
            maxPortScan: opts.maxPortScan ?? 20,
            announceIp: opts.announceIp ?? "",
            peerPort: opts.peerPort ?? 8800,
            stateManager: opts.stateManager,
        };
    }
    // ─── Start ──────────────────────────────────────────────────────────────────
    async start() {
        if (this.started)
            throw new Error("LANShare already started");
        const coordinatorPort = await this.electCoordinator();
        // Only set localhost URL if electCoordinator didn't already set a remote one
        if (!this.coordinatorUrl) {
            this.coordinatorUrl = `http://127.0.0.1:${coordinatorPort}`;
        }
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
     * Election flow (local + LAN):
     *
     *  1. Thử bind từng port trong range.
     *  2. Nếu port bị chiếm cục bộ + /get-health = "ipsw-manager" → join làm peer.
     *  3. Nếu port bị chiếm bởi app khác → thử port kế.
     *  4. Nếu bind thành công → quét LAN tìm coordinator có sẵn:
     *     a. Có coordinator trên LAN → hủy bind, join làm peer trỏ đến IP đó.
     *     b. Không có → máy này làm coordinator.
     */
    async electCoordinator() {
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
                    await new Promise(resolve => bound.close(() => resolve()));
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
    // ─── Downloader reference ──────────────────────────────────────────────────
    setDownloader(dl) {
        this.downloaderRef = dl;
    }
    // ─── Download API ────────────────────────────────────────────────────────────
    async download(opts) {
        this.assertStarted();
        const downloadId = (0, crypto_1.randomUUID)();
        const tmpPath = path.join(opts.tmpDir, `${downloadId}.ipsw.tmp`);
        const sm = this.opts.stateManager;
        // Build initial DownloadState (compatible with main downloader)
        if (sm) {
            const state = {
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
        const progressWithSource = (info) => {
            opts.onProgress?.({ ...info, source: "lan" });
        };
        // Attempt LAN download
        const downloader = new downloader_1.PeerDownloader(this.node);
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
            const fs = await Promise.resolve().then(() => __importStar(require("fs")));
            const finalPath = path.join(opts.savePath, opts.fileName || opts.firmware.url.split("/").pop() || `${opts.firmware.identifier}_${opts.firmware.buildid}.ipsw`);
            const destDir = path.dirname(finalPath);
            if (!fs.existsSync(destDir))
                fs.mkdirSync(destDir, { recursive: true });
            try {
                fs.renameSync(tmpPath, finalPath);
            }
            catch {
                fs.copyFileSync(tmpPath, finalPath);
                try {
                    fs.unlinkSync(tmpPath);
                }
                catch { }
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
        }
        catch (err) {
            this.activeLanDownloads.delete(downloadId);
            console.warn(`[LANShare] LAN download failed: ${err.message}`);
            // Check if we have any partial progress
            const state = sm?.load(downloadId);
            const hasProgress = state && state.chunks.some(c => c.completed || c.downloaded > 0);
            if (!hasProgress) {
                // No progress — clean up and fall back to CDN fresh download
                sm?.delete(downloadId);
                try {
                    (await Promise.resolve().then(() => __importStar(require("fs")))).unlinkSync(tmpPath);
                }
                catch { }
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
    cancelDownload(downloadId) {
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
