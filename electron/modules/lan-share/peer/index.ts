/**
 * client-example/index.ts
 *
 * Example: How a peer discovers and downloads a file from the LAN.
 *
 * Run this after starting:
 *   1. The coordinator (coordinator/server.ts)
 *   2. One or more peers sharing files (peer/node.ts)
 */

import * as path from "path";
import { PeerNode } from "../peer/node";
import { PeerDownloader } from "../peer/downloader";
import { formatBytes, formatSpeed } from "../shared/utils";

const COORDINATOR_URL = process.env.COORDINATOR_URL ?? "http://192.168.1.10:8700";
const SHARE_DIR = process.env.SHARE_DIR ?? path.join(process.cwd(), "shared-files");
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? path.join(process.cwd(), "downloads");

// ─── Example 1: Start a peer node ─────────────────────────────────────────────

async function exampleStartPeer(): Promise<PeerNode> {
  const node = new PeerNode({
    coordinatorUrl: COORDINATOR_URL,
    shareDir: SHARE_DIR,
    storageType: "SSD",           // or "HDD"
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

async function exampleDownloadFile(node?: PeerNode): Promise<void> {
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

  const { locations } = await coordRes.json() as {
    fileId: string;
    locations: Array<{ nodeId: string; ip: string; port: number; storageType: string }>;
  };

  console.log(`[Client] Found on ${locations.length} peer(s):`);
  for (const loc of locations) {
    console.log(`  - ${loc.nodeId.slice(0, 8)} @ ${loc.ip}:${loc.port} (${loc.storageType})`);
  }

  // Step 2: Get file metadata from first peer (HEAD request)
  const firstPeer = locations[0];

  // We need the file size for the chunk plan — get it from any peer
  const peerInfoRes = await fetch(`http://${firstPeer.ip}:${firstPeer.port}/health`);
  const peerInfo = await peerInfoRes.json() as any;

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

  console.log(`[Client] File size: ${formatBytes(fileSize)}`);
  console.log(`[Client] Saving to: ${DOWNLOAD_DIR}`);

  // Step 3: Download
  const downloader = new PeerDownloader(node);
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
        process.stdout.write(
          `\r  ${info.pct.toString().padStart(3)}% | ` +
          `${formatBytes(info.downloaded)} / ${formatBytes(info.total)} | ` +
          `${formatSpeed(info.speed)} | ` +
          `${info.activeChunks} chunks | ${eta}    `
        );
      }
    },
  });

  const elapsedSec = (Date.now() - startTime) / 1000;
  const avgSpeed = fileSize / elapsedSec;
  console.log(`\n\n[Client] ✓ Downloaded in ${elapsedSec.toFixed(1)}s @ ${formatSpeed(avgSpeed)}`);
  console.log(`[Client] Saved to: ${outputPath}`);
}

// ─── Example 3: Multi-source chunk plan demo ──────────────────────────────────

async function exampleShowChunkPlan(): Promise<void> {
  const { buildChunkPlan } = await import("../shared/utils");

  const fakePeers = [
    { nodeId: "peer-a", ip: "192.168.1.10", port: 8800, storageType: "SSD" as const, activeUploads: 0, activeDownloads: 0 },
    { nodeId: "peer-b", ip: "192.168.1.11", port: 8800, storageType: "SSD" as const, activeUploads: 1, activeDownloads: 0 },
    { nodeId: "peer-c", ip: "192.168.1.12", port: 8800, storageType: "HDD" as const, activeUploads: 0, activeDownloads: 0 },
  ];

  const fileSize = 5 * 1024 ** 3; // 5 GB
  const plan = buildChunkPlan(fileSize, fakePeers, 32 * 1024 * 1024);

  console.log(`\n[ChunkPlan] ${plan.length} chunks for a ${formatBytes(fileSize)} file across ${fakePeers.length} peers:\n`);

  const byPeer = new Map<string, number>();
  for (const chunk of plan) {
    byPeer.set(chunk.nodeId, (byPeer.get(chunk.nodeId) ?? 0) + 1);
  }

  for (const [nodeId, count] of byPeer) {
    const peer = fakePeers.find(p => p.nodeId === nodeId)!;
    const bytes = count * 32 * 1024 * 1024;
    console.log(`  ${peer.storageType === "SSD" ? "💾" : "🖴 "} ${nodeId} (${peer.storageType}) — ${count} chunks ≈ ${formatBytes(bytes)}`);
  }
}

// ─── CLI entry ─────────────────────────────────────────────────────────────────

const mode = process.env.MODE ?? "download";

(async () => {
  if (mode === "peer") {
    await exampleStartPeer();
  } else if (mode === "plan") {
    await exampleShowChunkPlan();
  } else {
    // Default: start peer + download
    const node = await exampleStartPeer();
    await exampleDownloadFile(node);
  }
})().catch(err => {
  console.error("[Client] Fatal:", err);
  process.exit(1);
});
