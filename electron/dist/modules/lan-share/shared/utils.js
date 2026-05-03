"use strict";
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
exports.calcCapacity = calcCapacity;
exports.canAcceptUpload = canAcceptUpload;
exports.rankCandidates = rankCandidates;
exports.buildChunkPlan = buildChunkPlan;
exports.isPortFree = isPortFree;
exports.findFreePort = findFreePort;
exports.formatBytes = formatBytes;
exports.formatSpeed = formatSpeed;
const net = __importStar(require("net"));
// ─── Capacity helpers ─────────────────────────────────────────────────────────
const BASE_CAPACITY = { SSD: 4, HDD: 2, unknown: 0 };
/**
 * Returns remaining capacity slots for this peer.
 * Downloads have higher priority — if any downloads are active, uploads are rejected.
 */
function calcCapacity(storageType, activeUploads, activeDownloads) {
    const base = BASE_CAPACITY[storageType];
    return Math.max(0, base - activeUploads - activeDownloads);
}
/**
 * Determines whether a peer can accept a new upload request.
 */
function canAcceptUpload(info) {
    const capacity = calcCapacity(info.storageType, info.activeUploads, info.activeDownloads);
    // Priority rule: if node is actively downloading, reject uploads
    if (info.activeDownloads > 0) {
        return {
            status: "BUSY",
            reason: "Node is actively downloading — uploads deprioritised",
            score: 0,
            activeDownloads: info.activeDownloads,
            activeUploads: info.activeUploads,
        };
    }
    if (capacity <= 0) {
        return {
            status: "BUSY",
            reason: "No upload slots available",
            score: 0,
            activeDownloads: info.activeDownloads,
            activeUploads: info.activeUploads,
        };
    }
    // Score: SSD preferred, fewer uploads preferred (0–100)
    const storageBonus = info.storageType === "SSD" ? 40 : 0;
    const slotScore = Math.min(60, capacity * 15);
    const score = storageBonus + slotScore;
    return {
        status: "ACCEPT",
        score,
        activeDownloads: info.activeDownloads,
        activeUploads: info.activeUploads,
    };
}
// ─── Node selection ───────────────────────────────────────────────────────────
/**
 * Sort and filter candidates for a download.
 * Returns candidates in order of preference (best first).
 */
function rankCandidates(candidates) {
    return [...candidates]
        .filter(c => {
        const capacity = calcCapacity(c.storageType, c.activeUploads, c.activeDownloads);
        return capacity > 0 && c.activeDownloads === 0; // won't serve if busy downloading
    })
        .sort((a, b) => {
        // 1. Prefer SSD
        const ssdDiff = (b.storageType === "SSD" ? 1 : 0) - (a.storageType === "SSD" ? 1 : 0);
        if (ssdDiff !== 0)
            return ssdDiff;
        // 2. Prefer fewer active uploads
        const uploadDiff = a.activeUploads - b.activeUploads;
        if (uploadDiff !== 0)
            return uploadDiff;
        return 0;
    });
}
/**
 * Build a multi-source chunk plan for a file.
 * Splits the file into N chunks distributed across available peers.
 */
function buildChunkPlan(fileSize, candidates, maxChunkSize = 32 * 1024 * 1024 // 32 MB
) {
    const ranked = rankCandidates(candidates);
    if (ranked.length === 0)
        return [];
    const chunks = [];
    let offset = 0;
    let peerIndex = 0;
    while (offset < fileSize) {
        const rangeEnd = Math.min(offset + maxChunkSize - 1, fileSize - 1);
        const peer = ranked[peerIndex % ranked.length];
        chunks.push({
            index: chunks.length,
            nodeId: peer.nodeId,
            ip: peer.ip,
            port: peer.port,
            rangeStart: offset,
            rangeEnd,
        });
        offset = rangeEnd + 1;
        peerIndex++;
    }
    return chunks;
}
// ─── Port utilities ───────────────────────────────────────────────────────────
/**
 * Check if a port is available. Returns true if free.
 */
function isPortFree(port, host = "0.0.0.0") {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port, host);
    });
}
/**
 * Find the first available port in a range.
 */
async function findFreePort(start, end = start + 20) {
    for (let port = start; port <= end; port++) {
        if (await isPortFree(port))
            return port;
    }
    throw new Error(`No free port found in range ${start}–${end}`);
}
// ─── Formatting ───────────────────────────────────────────────────────────────
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 ** 2)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3)
        return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function formatSpeed(bps) {
    return `${formatBytes(bps)}/s`;
}
