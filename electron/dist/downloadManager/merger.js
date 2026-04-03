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
exports.mergeParts = mergeParts;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Merge all part temp files into the final destination file.
 * Streams part-by-part to avoid high memory usage (important for large .ipsw files).
 * If isHDDDest, first writes to a temp SSD file, then moves to final dest.
 */
async function mergeParts(opts) {
    const { parts, destPath, isHDDDest, tempDir, onProgress, onDone, onError } = opts;
    // Sort by index just in case
    const sorted = [...parts].sort((a, b) => a.index - b.index);
    const totalBytes = sorted.reduce((sum, p) => sum + (p.endBytes - p.startBytes + 1), 0);
    // Write to SSD temp first if HDD dest, then rename
    const writeDest = isHDDDest
        ? path.join(tempDir, `_merged_${path.basename(destPath)}`)
        : destPath;
    try {
        // Ensure destination directory exists
        fs.mkdirSync(path.dirname(writeDest), { recursive: true });
        const ws = fs.createWriteStream(writeDest, { flags: "w" });
        let bytesWritten = 0;
        for (const part of sorted) {
            await streamFile(part.tempFile, ws, (chunk) => {
                bytesWritten += chunk;
                const pct = Math.min(100, Math.round((bytesWritten / totalBytes) * 100));
                onProgress(pct, bytesWritten, totalBytes);
            });
        }
        await new Promise((res, rej) => ws.end((err) => (err ? rej(err) : res())));
        if (isHDDDest) {
            // Move from SSD temp to HDD final destination
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            await moveFile(writeDest, destPath, (pct, written, total) => onProgress(pct, written, total));
        }
        // Dọn dẹp toàn bộ thư mục temp (xóa đệ quy, không cần unlink từng file)
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        catch { }
        onDone();
    }
    catch (err) {
        onError(err);
    }
}
/** Stream a file into an open write stream, calling onChunk per chunk. */
function streamFile(src, ws, onChunk) {
    return new Promise((resolve, reject) => {
        const rs = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 }); // 4 MB chunks
        rs.on("data", (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            onChunk(buf.byteLength);
            const canContinue = ws.write(buf);
            if (!canContinue)
                rs.pause();
        });
        ws.on("drain", () => rs.resume());
        rs.on("end", resolve);
        rs.on("error", reject);
    });
}
/**
 * Move file using streaming copy (handles cross-device moves, e.g., SSD → HDD).
 */
function moveFile(src, dest, onProgress) {
    return new Promise((resolve, reject) => {
        let total = 0;
        try {
            total = fs.statSync(src).size;
        }
        catch { }
        const rs = fs.createReadStream(src, { highWaterMark: 8 * 1024 * 1024 });
        const ws = fs.createWriteStream(dest, { flags: "w" });
        let written = 0;
        rs.on("data", (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            written += buf.byteLength;
            const pct = total ? Math.round((written / total) * 100) : 0;
            onProgress(pct, written, total);
        });
        rs.pipe(ws);
        ws.on("finish", () => {
            try {
                fs.unlinkSync(src);
            }
            catch { }
            resolve();
        });
        ws.on("error", reject);
        rs.on("error", reject);
    });
}
