"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanFolder = scanFolder;
exports.createMd5 = createMd5;
exports.deleteFile = deleteFile;
const path_1 = require("path");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
function scanFolder(folder) {
    const files = (0, fs_1.readdirSync)(folder)
        .filter(f => f.endsWith(".ipsw"))
        .map(f => ({
        name: f,
        path: (0, path_1.join)(folder, f),
        sizeMB: Math.round((0, fs_1.statSync)((0, path_1.join)(folder, f)).size / 1e6),
        size: (0, fs_1.statSync)((0, path_1.join)(folder, f)).size
    }));
    return files;
}
async function createMd5(filePath, options) {
    return new Promise((resolve, reject) => {
        const hash = (0, crypto_1.createHash)('md5');
        // Tăng buffer size cho file lớn (mặc định 64KB -> 1MB)
        const highWaterMark = options?.highWaterMark || 1024 * 1024; // 1MB
        const throttleMs = options?.throttleMs || 500; // Update mỗi 500ms
        const stream = (0, fs_1.createReadStream)(filePath, {
            highWaterMark,
            autoClose: true
        });
        let totalBytes = 0;
        let bytesRead = 0;
        let lastTime = Date.now();
        let lastBytesRead = 0;
        let lastProgressUpdate = 0;
        // Lấy kích thước file trước khi bắt đầu stream
        (0, fs_1.stat)(filePath, (err, stats) => {
            if (err) {
                reject(err);
                return;
            }
            totalBytes = stats.size;
        });
        stream.on('data', (chunk) => {
            hash.update(chunk);
            bytesRead += chunk.length;
            // Throttle progress updates để tránh gọi quá nhiều
            if (options?.onProgress && totalBytes > 0) {
                const now = Date.now();
                if (now - lastProgressUpdate >= throttleMs) {
                    const timeDiff = (now - lastTime) / 1000; // giây
                    const bytesDiff = bytesRead - lastBytesRead;
                    const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                    const percent = (bytesRead / totalBytes) * 100;
                    // Tính ETA (Estimated Time of Arrival)
                    const remainingBytes = totalBytes - bytesRead;
                    const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;
                    options.onProgress({
                        percent: Math.round(Math.min(percent, 100)),
                        speed: Math.round(speed),
                        totalBytes,
                        bytesRead,
                        eta
                    });
                    lastTime = now;
                    lastBytesRead = bytesRead;
                    lastProgressUpdate = now;
                }
            }
        });
        stream.on('end', () => {
            // Gọi progress callback lần cuối với 100%
            if (options?.onProgress && totalBytes > 0) {
                options.onProgress({
                    percent: 100,
                    speed: 0,
                    totalBytes,
                    bytesRead: totalBytes,
                    eta: 0
                });
            }
            const md5 = hash.digest('hex');
            resolve(md5);
        });
        stream.on('error', (err) => {
            // Đảm bảo stream được đóng khi có lỗi
            stream.destroy();
            reject(err);
        });
    });
}
async function deleteFile(filePath) {
    try {
        await fs_1.promises.unlink(filePath);
        return { success: true };
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { success: true };
        }
        return {
            success: false,
            error: err.message,
            code: err.code,
        };
    }
}
