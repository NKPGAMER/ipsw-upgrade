"use strict";
/**
 * client-example/index.ts
 *
 * Example: How a peer discovers and downloads a file from the LAN.
 *
 * Run this after starting:
 *   1. The coordinator (coordinator/server.ts)
 *   2. One or more peers sharing files (peer/node.ts)
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
const path = __importStar(require("path"));
const node_1 = require("../peer/node");
const downloader_1 = require("../peer/downloader");
const utils_1 = require("../shared/utils");
const COORDINATOR_URL = process.env.COORDINATOR_URL ?? "http://192.168.1.10:8700";
const SHARE_DIR = process.env.SHARE_DIR ?? path.join(process.cwd(), "shared-files");
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? path.join(process.cwd(), "downloads");
// ─── Example 1: Start a peer node ─────────────────────────────────────────────
async function exampleStartPeer() {
    const node = new node_1.PeerNode({
        coordinatorUrl: COORDINATOR_URL,
        shareDir: SHARE_DIR,
        storageType: "SSD", // or "HDD"
        preferredPort: 8800,
    });
    await node.start();
    // Graceful shutdown
    process.on("SIGINT", async () => {
        await node.stop();
        process.exit(0);
    });
    return node;
}
// ─── Example 2: Download a file from the LAN ──────────────────────────────────
async function exampleDownloadFile(node) {
    const fileId = process.argv[2]; // pass fileId as CLI arg
    if (!fileId) {
        console.error("Usage: ts-node client-example/index.ts <fileId>");
        console.error("\nFirst, query the coordinator to find available files:");
        console.error(`  curl ${COORDINATOR_URL}/peers`);
        process.exit(1);
    }
    // Step 1: Query coordinator for file info
    console.log(`\n[Client] Querying coordinator for file: ${fileId}`);
    const coordRes = await fetch(`${COORDINATOR_URL}/files/${fileId}`);
    if (!coordRes.ok) {
        console.error("[Client] File not found in the network");
        process.exit(1);
    }
    const { locations } = await coordRes.json();
    console.log(`[Client] Found on ${locations.length} peer(s):`);
    for (const loc of locations) {
        console.log(`  - ${loc.nodeId.slice(0, 8)} @ ${loc.ip}:${loc.port} (${loc.storageType})`);
    }
    // Step 2: Get file metadata from first peer (HEAD request)
    const firstPeer = locations[0];
    // We need the file size for the chunk plan — get it from any peer
    const peerInfoRes = await fetch(`http://${firstPeer.ip}:${firstPeer.port}/health`);
    const peerInfo = await peerInfoRes.json();
    // For the demo, we'll retrieve size from a "describe" endpoint.
    // In a real system, the coordinator would store file metadata (size, name).
    // Here we'll use a /file/:id with a HEAD request:
    const sizeRes = await fetch(`http://${firstPeer.ip}:${firstPeer.port}/file/${fileId}`, {
        method: "GET",
        headers: { range: "bytes=0-0" },
    });
    const contentRange = sizeRes.headers.get("content-range") ?? "";
    const totalSizeMatch = contentRange.match(/\/(\d+)$/);
    const fileSize = totalSizeMatch ? parseInt(totalSizeMatch[1]) : 0;
    await sizeRes.body?.cancel();
    if (!fileSize) {
        console.error("[Client] Could not determine file size");
        process.exit(1);
    }
    console.log(`[Client] File size: ${(0, utils_1.formatBytes)(fileSize)}`);
    console.log(`[Client] Saving to: ${DOWNLOAD_DIR}`);
    // Step 3: Download
    const downloader = new downloader_1.PeerDownloader(node);
    const outputPath = path.join(DOWNLOAD_DIR, `${fileId.slice(0, 12)}.bin`);
    const startTime = Date.now();
    let lastPct = -1;
    await downloader.download({
        coordinatorUrl: COORDINATOR_URL,
        fileId,
        fileName: fileId,
        fileSize,
        outputPath,
        maxConcurrentChunks: 6,
        chunkSize: 32 * 1024 * 1024,
        onProgress: (info) => {
            if (info.pct !== lastPct) {
                lastPct = info.pct;
                const eta = info.eta ? `ETA: ${info.eta}s` : "";
                process.stdout.write(`\r  ${info.pct.toString().padStart(3)}% | ` +
                    `${(0, utils_1.formatBytes)(info.downloaded)} / ${(0, utils_1.formatBytes)(info.total)} | ` +
                    `${(0, utils_1.formatSpeed)(info.speed)} | ` +
                    `${info.activeChunks} chunks | ${eta}    `);
            }
        },
    });
    const elapsedSec = (Date.now() - startTime) / 1000;
    const avgSpeed = fileSize / elapsedSec;
    console.log(`\n\n[Client] ✓ Downloaded in ${elapsedSec.toFixed(1)}s @ ${(0, utils_1.formatSpeed)(avgSpeed)}`);
    console.log(`[Client] Saved to: ${outputPath}`);
}
// ─── Example 3: Multi-source chunk plan demo ──────────────────────────────────
async function exampleShowChunkPlan() {
    const { buildChunkPlan } = await Promise.resolve().then(() => __importStar(require("../shared/utils")));
    const fakePeers = [
        { nodeId: "peer-a", ip: "192.168.1.10", port: 8800, storageType: "SSD", activeUploads: 0, activeDownloads: 0 },
        { nodeId: "peer-b", ip: "192.168.1.11", port: 8800, storageType: "SSD", activeUploads: 1, activeDownloads: 0 },
        { nodeId: "peer-c", ip: "192.168.1.12", port: 8800, storageType: "HDD", activeUploads: 0, activeDownloads: 0 },
    ];
    const fileSize = 5 * 1024 ** 3; // 5 GB
    const plan = buildChunkPlan(fileSize, fakePeers, 32 * 1024 * 1024);
    console.log(`\n[ChunkPlan] ${plan.length} chunks for a ${(0, utils_1.formatBytes)(fileSize)} file across ${fakePeers.length} peers:\n`);
    const byPeer = new Map();
    for (const chunk of plan) {
        byPeer.set(chunk.nodeId, (byPeer.get(chunk.nodeId) ?? 0) + 1);
    }
    for (const [nodeId, count] of byPeer) {
        const peer = fakePeers.find(p => p.nodeId === nodeId);
        const bytes = count * 32 * 1024 * 1024;
        console.log(`  ${peer.storageType === "SSD" ? "💾" : "🖴 "} ${nodeId} (${peer.storageType}) — ${count} chunks ≈ ${(0, utils_1.formatBytes)(bytes)}`);
    }
}
// ─── CLI entry ─────────────────────────────────────────────────────────────────
const mode = process.env.MODE ?? "download";
(async () => {
    if (mode === "peer") {
        await exampleStartPeer();
    }
    else if (mode === "plan") {
        await exampleShowChunkPlan();
    }
    else {
        // Default: start peer + download
        const node = await exampleStartPeer();
        await exampleDownloadFile(node);
    }
})().catch(err => {
    console.error("[Client] Fatal:", err);
    process.exit(1);
});
