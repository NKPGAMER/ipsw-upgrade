"use strict";
/**
 * coordinator/server.ts
 *
 * Central coordinator — pure control plane.
 * Tracks peers and file locations. NEVER relays file data.
 *
 * API:
 *   POST /register       — peer joins
 *   POST /heartbeat      — peer keepalive + load update
 *   GET  /files/:fileId  — query which peers have a file
 *   GET  /peers          — list all live peers
 *   GET  /health         — coordinator health check
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeerRegistry = void 0;
exports.createCoordinatorApp = createCoordinatorApp;
exports.startCoordinator = startCoordinator;
const express_1 = __importDefault(require("express"));
const utils_1 = require("../shared/utils");
const PEER_TTL_MS = 30_000; // peer is considered dead after 30s without heartbeat
class PeerRegistry {
    peers = new Map();
    sweepTimer;
    constructor() {
        // Sweep dead peers every 15s
        this.sweepTimer = setInterval(() => this.sweep(), 15_000);
        this.sweepTimer.unref();
    }
    register(reg) {
        const now = Date.now();
        const existing = this.peers.get(reg.nodeId);
        const fileMap = existing?.files ?? new Map();
        for (const f of reg.files) {
            fileMap.set(f.fileId, f);
        }
        this.peers.set(reg.nodeId, {
            nodeId: reg.nodeId,
            ip: reg.ip,
            port: reg.port,
            storageType: reg.storageType,
            activeUploads: 0,
            activeDownloads: 0,
            lastSeen: now,
            files: fileMap,
        });
        console.log(`[Registry] Registered ${reg.nodeId} @ ${reg.ip}:${reg.port} (${reg.storageType}), ${reg.files.length} files`);
    }
    heartbeat(payload) {
        const peer = this.peers.get(payload.nodeId);
        if (!peer)
            return false;
        peer.activeUploads = payload.activeUploads;
        peer.activeDownloads = payload.activeDownloads;
        peer.lastSeen = Date.now();
        if (payload.files) {
            for (const f of payload.files) {
                peer.files.set(f.fileId, f);
            }
        }
        return true;
    }
    findFile(fileId) {
        const locations = [];
        const now = Date.now();
        for (const peer of this.peers.values()) {
            if (now - peer.lastSeen > PEER_TTL_MS)
                continue;
            if (peer.files.has(fileId)) {
                locations.push({
                    nodeId: peer.nodeId,
                    ip: peer.ip,
                    port: peer.port,
                    storageType: peer.storageType,
                    activeUploads: peer.activeUploads,
                    activeDownloads: peer.activeDownloads,
                });
            }
        }
        return locations;
    }
    listLivePeers() {
        const now = Date.now();
        return [...this.peers.values()]
            .filter(p => now - p.lastSeen <= PEER_TTL_MS)
            .map(({ files: _files, ...rest }) => rest);
    }
    sweep() {
        const now = Date.now();
        let removed = 0;
        for (const [id, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_TTL_MS * 2) {
                this.peers.delete(id);
                removed++;
            }
        }
        if (removed > 0)
            console.log(`[Registry] Swept ${removed} dead peers`);
    }
    destroy() {
        clearInterval(this.sweepTimer);
    }
}
exports.PeerRegistry = PeerRegistry;
// ─── Coordinator app ──────────────────────────────────────────────────────────
function createCoordinatorApp(registry) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "1mb" }));
    // ── POST /register ─────────────────────────────────────────────────────────
    app.post("/register", (req, res) => {
        const body = req.body;
        if (!body.nodeId || !body.ip || !body.port || !body.storageType) {
            res.status(400).json({ error: "Missing required fields: nodeId, ip, port, storageType" });
            return;
        }
        // Prefer the socket's IP if the peer didn't provide one or sent 127.0.0.1
        if (!body.ip || body.ip === "127.0.0.1") {
            body.ip = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? body.ip;
        }
        registry.register(body);
        res.json({ ok: true, message: "Registered" });
    });
    // ── POST /heartbeat ────────────────────────────────────────────────────────
    app.post("/heartbeat", (req, res) => {
        const body = req.body;
        if (!body.nodeId) {
            res.status(400).json({ error: "Missing nodeId" });
            return;
        }
        const found = registry.heartbeat(body);
        if (!found) {
            res.status(404).json({ error: "Node not registered. Call /register first." });
            return;
        }
        res.json({ ok: true });
    });
    // ── GET /files/:fileId ─────────────────────────────────────────────────────
    app.get("/files/:fileId", (req, res) => {
        const { fileId } = req.params;
        const locations = registry.findFile(fileId);
        if (locations.length === 0) {
            res.status(404).json({ error: "File not found on any live peer" });
            return;
        }
        res.json({ fileId, locations });
    });
    // ── GET /peers ─────────────────────────────────────────────────────────────
    app.get("/peers", (_req, res) => {
        res.json({ peers: registry.listLivePeers() });
    });
    // ── GET /health ────────────────────────────────────────────────────────────
    app.get("/health", (_req, res) => {
        const peers = registry.listLivePeers();
        res.json({ status: "ok", livePeers: peers.length, uptime: process.uptime() });
    });
    // ── 404 catch-all ──────────────────────────────────────────────────────────
    app.use((_req, res) => {
        res.status(404).json({ error: "Not found" });
    });
    // ── Error handler ──────────────────────────────────────────────────────────
    app.use((err, _req, res, _next) => {
        console.error("[Coordinator] error:", err);
        res.status(500).json({ error: "Internal server error" });
    });
    return app;
}
// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function startCoordinator(preferredPort = 8700) {
    const port = await (0, utils_1.findFreePort)(preferredPort);
    const registry = new PeerRegistry();
    const app = createCoordinatorApp(registry);
    const server = app.listen(port, "0.0.0.0", () => {
        console.log(`\n[Coordinator] Listening on port ${port}`);
        console.log(`[Coordinator] Peers will register at: http://<this-machine-ip>:${port}/register\n`);
    });
    // Graceful shutdown
    process.on("SIGINT", () => {
        registry.destroy();
        server.close(() => {
            console.log("[Coordinator] Shut down cleanly");
            process.exit(0);
        });
    });
}
// Standalone entry
if (require.main === module) {
    startCoordinator().catch(err => {
        console.error("[Coordinator] Fatal:", err);
        process.exit(1);
    });
}
