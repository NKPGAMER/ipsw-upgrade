"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanFolder = scanFolder;
exports.createMd5 = createMd5;
exports.deleteFile = deleteFile;
const path_1 = require("path");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const fs_2 = require("fs");
const fs_extra_1 = __importDefault(require("fs-extra"));
async function scanFolder(folder) {
    if (!(await fs_extra_1.default.pathExists(folder)))
        return [];
    const entries = await fs_2.promises.readdir(folder, { withFileTypes: true });
    const ipswFiles = entries.filter(entry => entry.isFile() && entry.name.endsWith(".ipsw"));
    const files = await Promise.all(ipswFiles.map(async (entry) => {
        const fullPath = (0, path_1.join)(folder, entry.name);
        const stats = await fs_2.promises.stat(fullPath);
        return {
            name: entry.name,
            path: fullPath,
            size: stats.size,
        };
    }));
    return files;
}
async function createMd5(filePath, options) {
    return new Promise((resolve, reject) => {
        const hash = (0, crypto_1.createHash)("md5");
        const highWaterMark = options?.highWaterMark || 1024 * 1024;
        const throttleMs = options?.throttleMs || 500;
        const stream = (0, fs_1.createReadStream)(filePath, { highWaterMark, autoClose: true });
        let totalBytes = 0;
        let bytesRead = 0;
        let lastTime = Date.now();
        let lastBytesRead = 0;
        let lastProgressUpdate = 0;
        fs_2.promises.stat(filePath)
            .then(stats => { totalBytes = stats.size; })
            .catch(reject);
        stream.on("data", (chunk) => {
            hash.update(chunk);
            bytesRead += chunk.length;
            if (options?.onProgress && totalBytes > 0) {
                const now = Date.now();
                if (now - lastProgressUpdate >= throttleMs) {
                    const timeDiff = (now - lastTime) / 1000;
                    const bytesDiff = bytesRead - lastBytesRead;
                    const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                    const percent = (bytesRead / totalBytes) * 100;
                    const remainingBytes = totalBytes - bytesRead;
                    const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;
                    options.onProgress({
                        percent: Math.round(Math.min(percent, 100)),
                        speed: Math.round(speed),
                        totalBytes,
                        bytesRead,
                        eta,
                    });
                    lastTime = now;
                    lastBytesRead = bytesRead;
                    lastProgressUpdate = now;
                }
            }
        });
        stream.on("end", () => {
            if (options?.onProgress && totalBytes > 0) {
                options.onProgress({ percent: 100, speed: 0, totalBytes, bytesRead: totalBytes, eta: 0 });
            }
            resolve(hash.digest("hex"));
        });
        stream.on("error", (err) => {
            stream.destroy();
            reject(err);
        });
    });
}
async function deleteFile(filePath) {
    try {
        await fs_2.promises.unlink(filePath);
        return { success: true };
    }
    catch (err) {
        if (err.code === "ENOENT")
            return { success: true };
        return { success: false, error: err.message, code: err.code };
    }
}
