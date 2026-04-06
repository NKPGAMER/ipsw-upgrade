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
/**
 * Copy worker — cross-device file copy with real progress.
 * Uses OS-native commands (robocopy/cp) for max speed, falls back to manual loop.
 */
const worker_threads_1 = require("worker_threads");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const { src, dest, srcOffset = 0, length } = worker_threads_1.workerData;
function post(msg) { worker_threads_1.parentPort.postMessage(msg); }
// ── Partial copy (pipeline mode): always manual, src is a live-written tmp file ──
function copyPartial(src, dest, srcOffset, length) {
    const CHUNK = 256 * 1024 * 1024;
    const srcFd = fs.openSync(src, "r");
    // Open dest for random-access write so pipeline chunks can be written in order
    const dstFd = fs.openSync(dest, fs.existsSync(dest) ? "r+" : "w", 0o644);
    const buf = Buffer.allocUnsafe(CHUNK);
    let remaining = length;
    let srcPos = srcOffset;
    let dstPos = srcOffset; // write to same offset in dest
    try {
        while (remaining > 0) {
            const toRead = Math.min(CHUNK, remaining);
            const bytesRead = fs.readSync(srcFd, buf, 0, toRead, srcPos);
            if (bytesRead === 0)
                break;
            fs.writeSync(dstFd, buf, 0, bytesRead, dstPos);
            srcPos += bytesRead;
            dstPos += bytesRead;
            remaining -= bytesRead;
            post({ type: "progress", bytes: length - remaining, total: length });
        }
    }
    finally {
        try {
            fs.closeSync(srcFd);
        }
        catch { }
        try {
            fs.closeSync(dstFd);
        }
        catch { }
    }
}
// ── Full copy: Windows robocopy, Unix cp, then manual fallback ──
async function copyFull(src, dest, totalSize) {
    if (process.platform === "win32") {
        await copyWindows(src, dest, totalSize).catch(() => copyManual(src, dest, totalSize));
    }
    else {
        await copyUnix(src, dest, totalSize).catch(() => copyManual(src, dest, totalSize));
    }
}
function copyWindows(src, dest, totalSize) {
    return new Promise((resolve, reject) => {
        const srcDir = path.dirname(src);
        const srcFile = path.basename(src);
        const dstDir = path.dirname(dest);
        const dstFile = path.basename(dest);
        const args = [srcDir, dstDir, srcFile, "/J", "/NP", "/NFL", "/NDL", "/NJH", "/NJS"];
        const proc = (0, child_process_1.spawn)("robocopy", args, { stdio: ["ignore", "pipe", "pipe"] });
        let lastBytes = 0;
        const poll = setInterval(() => {
            try {
                const written = fs.statSync(path.join(dstDir, srcFile)).size;
                if (written !== lastBytes) {
                    lastBytes = written;
                    post({ type: "progress", bytes: written, total: totalSize });
                }
            }
            catch { }
        }, 200);
        proc.on("close", (code) => {
            clearInterval(poll);
            if (code !== null && code < 8) {
                if (srcFile !== dstFile) {
                    try {
                        fs.renameSync(path.join(dstDir, srcFile), dest);
                    }
                    catch (e) {
                        return reject(e);
                    }
                }
                resolve();
            }
            else {
                reject(new Error(`robocopy exited ${code}`));
            }
        });
        proc.on("error", reject);
    });
}
function copyUnix(src, dest, totalSize) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)("cp", [src, dest], { stdio: "ignore" });
        let lastBytes = 0;
        const poll = setInterval(() => {
            try {
                const written = fs.statSync(dest).size;
                if (written !== lastBytes) {
                    lastBytes = written;
                    post({ type: "progress", bytes: written, total: totalSize });
                }
            }
            catch { }
        }, 200);
        proc.on("close", (code) => {
            clearInterval(poll);
            if (code === 0)
                resolve();
            else
                reject(new Error(`cp exited ${code}`));
        });
        proc.on("error", reject);
    });
}
function copyManual(src, dest, totalSize) {
    const CHUNK = 256 * 1024 * 1024;
    const srcFd = fs.openSync(src, "r");
    const dstFd = fs.openSync(dest, "w", 0o644);
    if (totalSize > 0)
        fs.ftruncateSync(dstFd, totalSize);
    const buf = Buffer.allocUnsafe(CHUNK);
    let offset = 0;
    try {
        while (offset < totalSize) {
            const n = fs.readSync(srcFd, buf, 0, CHUNK, offset);
            if (n === 0)
                break;
            fs.writeSync(dstFd, buf, 0, n, offset);
            offset += n;
            post({ type: "progress", bytes: offset, total: totalSize });
        }
    }
    finally {
        try {
            fs.closeSync(srcFd);
        }
        catch { }
        try {
            fs.closeSync(dstFd);
        }
        catch { }
    }
}
// ── Entry ──
async function run() {
    try {
        if (length !== undefined) {
            // Pipeline partial copy
            copyPartial(src, dest, srcOffset, length);
        }
        else {
            const totalSize = fs.statSync(src).size;
            await copyFull(src, dest, totalSize);
        }
        post({ type: "done" });
    }
    catch (err) {
        post({ type: "error", message: err.message });
    }
}
run();
