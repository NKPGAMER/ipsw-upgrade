"use strict";
/**
 * peer/file-server.ts
 *
 * HTTP file server running on each peer.
 * Supports:
 *   - Streaming large files (no buffering)
 *   - Range requests (resume support, multi-source)
 *   - Capacity enforcement (ACCEPT / BUSY)
 *   - Load tracking (activeUploads counter)
 *
 * API:
 *   GET /health              — health + capacity check
 *   GET /can-serve           — returns ACCEPT/BUSY + score
 *   GET /file/:fileId        — serve file (streaming, range-aware)
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileServer = createFileServer;
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const utils_1 = require("../shared/utils");
// ─── File Server ──────────────────────────────────────────────────────────────
function createFileServer(node) {
    const app = (0, express_1.default)();
    // ── GET /health ────────────────────────────────────────────────────────────
    app.get("/health", (_req, res) => {
        const info = node.getPeerInfo();
        const result = (0, utils_1.canAcceptUpload)(info);
        res.json({
            nodeId: node.nodeId,
            storageType: info.storageType,
            activeUploads: info.activeUploads,
            activeDownloads: info.activeDownloads,
            capacity: result.score,
            status: result.status,
            files: node.getFileCount(),
            uptime: process.uptime(),
        });
    });
    // ── GET /can-serve ─────────────────────────────────────────────────────────
    app.get("/can-serve", (_req, res) => {
        const info = node.getPeerInfo();
        const result = (0, utils_1.canAcceptUpload)(info);
        res.json(result);
    });
    // ── GET /file/:fileId ──────────────────────────────────────────────────────
    app.get("/file/:fileId", (req, res) => {
        const fileId = String(req.params.fileId);
        const entry = node.getFile(fileId);
        if (!entry) {
            res.status(404).json({ error: "File not found on this peer" });
            return;
        }
        // Capacity check — can we serve one more upload?
        const info = node.getPeerInfo();
        const check = (0, utils_1.canAcceptUpload)(info);
        if (check.status === "BUSY") {
            res.status(503).json({ error: "BUSY", reason: check.reason });
            return;
        }
        const filePath = entry.path;
        // File must exist
        let stat;
        try {
            stat = fs.statSync(filePath);
        }
        catch {
            res.status(404).json({ error: "File missing from disk" });
            return;
        }
        const fileSize = stat.size;
        const rangeHeader = req.headers.range;
        node.incrementUploads();
        res.on("finish", () => node.decrementUploads());
        res.on("close", () => node.decrementUploads());
        if (rangeHeader) {
            // ── Range request (partial content) ───────────────────────────────────
            const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
            if (!match) {
                res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
                return;
            }
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            if (start > end || end >= fileSize) {
                res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
                return;
            }
            const chunkSize = end - start + 1;
            res.status(206).set({
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": String(chunkSize),
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${encodeURIComponent(entry.name)}"`,
                "Cache-Control": "no-store",
                "X-Node-Id": node.nodeId,
            });
            // Sequential read — optimal for both SSD and HDD (avoid random I/O)
            const stream = fs.createReadStream(filePath, {
                start,
                end,
                highWaterMark: 256 * 1024, // 256 KB read buffers — balanced for network throughput
            });
            stream.on("error", (err) => {
                console.error(`[FileServer] Stream error for ${fileId}:`, err.message);
                if (!res.headersSent)
                    res.status(500).end();
            });
            stream.pipe(res);
        }
        else {
            // ── Full file request ──────────────────────────────────────────────────
            res.status(200).set({
                "Content-Length": String(fileSize),
                "Accept-Ranges": "bytes",
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${encodeURIComponent(entry.name)}"`,
                "Cache-Control": "no-store",
                "X-Node-Id": node.nodeId,
            });
            const stream = fs.createReadStream(filePath, {
                highWaterMark: 256 * 1024,
            });
            stream.on("error", (err) => {
                console.error(`[FileServer] Stream error for ${fileId}:`, err.message);
                if (!res.headersSent)
                    res.status(500).end();
            });
            stream.pipe(res);
        }
    });
    // ── Error handler ──────────────────────────────────────────────────────────
    app.use((err, _req, _res, next) => {
        console.error("[FileServer] Unhandled error:", err);
        next(err);
    });
    return app;
}
