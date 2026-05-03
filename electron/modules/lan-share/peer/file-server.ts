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

import express, { Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import type { FileEntry, CanServeResponse } from "../shared/types";
import { canAcceptUpload, findFreePort, formatBytes } from "../shared/utils";
import type { PeerNode } from "./node";

// ─── File Server ──────────────────────────────────────────────────────────────

export function createFileServer(node: PeerNode) {
  const app = express();

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    const info = node.getPeerInfo();
    const result = canAcceptUpload(info);
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
  app.get("/can-serve", (_req: Request, res: Response) => {
    const info = node.getPeerInfo();
    const result: CanServeResponse = canAcceptUpload(info);
    res.json(result);
  });

  // ── GET /file/:fileId ──────────────────────────────────────────────────────
  app.get("/file/:fileId", (req: Request, res: Response) => {
    const fileId = String(req.params.fileId);
    const entry = node.getFile(fileId);

    if (!entry) {
      res.status(404).json({ error: "File not found on this peer" });
      return;
    }

    // Capacity check — can we serve one more upload?
    const info = node.getPeerInfo();
    const check = canAcceptUpload(info);
    if (check.status === "BUSY") {
      res.status(503).json({ error: "BUSY", reason: check.reason });
      return;
    }

    const filePath = entry.path;

    // File must exist
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
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
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);
    } else {
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
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);
    }
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, _res: Response, next: NextFunction) => {
    console.error("[FileServer] Unhandled error:", err);
    next(err);
  });

  return app;
}
