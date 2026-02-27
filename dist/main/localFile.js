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
exports.scanFolder = scanFolder;
exports.createMd5 = createMd5;
const path_1 = require("path");
const fs_1 = require("fs");
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
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
async function createMd5(filePath, options) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        // Tăng buffer size cho file lớn (mặc định 64KB -> 1MB)
        const highWaterMark = options?.highWaterMark || 1024 * 1024; // 1MB
        const throttleMs = options?.throttleMs || 500; // Update mỗi 500ms
        const stream = fs.createReadStream(filePath, {
            highWaterMark,
            // Sử dụng autoClose để tự động đóng file descriptor
            autoClose: true
        });
        let totalBytes = 0;
        let bytesRead = 0;
        let lastTime = Date.now();
        let lastBytesRead = 0;
        let lastProgressUpdate = 0;
        // Lấy kích thước file trước khi bắt đầu stream
        fs.stat(filePath, (err, stats) => {
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
// Sử dụng:
async function example() {
    try {
        const md5 = await createMd5('/path/to/large/file.bin', {
            highWaterMark: 2 * 1024 * 1024, // 2MB buffer cho file rất lớn
            throttleMs: 1000, // Update UI mỗi 1 giây
            onProgress: (progress) => {
                const speedMB = (progress.speed / 1024 / 1024).toFixed(2);
                const etaMin = Math.floor(progress.eta / 60);
                const etaSec = progress.eta % 60;
                console.log(`Progress: ${progress.percent}% | ` +
                    `Speed: ${speedMB} MB/s | ` +
                    `ETA: ${etaMin}m ${etaSec}s`);
            }
        });
        console.log('MD5:', md5);
    }
    catch (error) {
        console.error('Error:', error);
    }
}
// // ============================================
// // VÍ DỤ SỬ DỤNG CHO FILE .IPSW
// // ============================================
// // Ví dụ 1: Xử lý file .ipsw với progress bar đầy đủ
// async function hashIpswFile() {
//   const filePath = '/path/to/iPhone_10GB.ipsw';
//   console.log('Đang tính MD5 hash cho file firmware...\n');
//   try {
//     const md5Hash = await createMd5(filePath, {
//       highWaterMark: 4 * 1024 * 1024, // 4MB cho file 10GB+
//       throttleMs: 200, // Update mỗi 200ms
//       onProgress: (info) => {
//         // Format hiển thị đẹp
//         const mbRead = (info.bytesRead / (1024 * 1024)).toFixed(2);
//         const mbTotal = (info.totalBytes / (1024 * 1024)).toFixed(2);
//         const bar = createProgressBar(info.percent);
//         const etaMin = Math.floor(info.eta / 60);
//         const etaSec = info.eta % 60;
//         process.stdout.write(
//           `\r${bar} ${info.percent.toFixed(1)}% | ` +
//           `${mbRead}/${mbTotal} MB | ` +
//           `${info.speed.toFixed(2)} MB/s | ` +
//           `ETA: ${etaMin}m ${etaSec}s   `
//         );
//       }
//     });
//     console.log('\n\n✓ Hoàn thành!');
//     console.log(`MD5: ${md5Hash}`);
//   } catch (error) {
//     console.error('\n✗ Lỗi:', error.message);
//   }
// }
// Ví dụ 2: Xác minh tính toàn vẹn file .ipsw
async function verifyIpswIntegrity() {
    const filePath = 'D:\\ShaLouData\\file\\ipsw\\iPhone_4.7_12.5.7_16H81_Restore.ipsw';
    const expectedMd5 = 'a1b2c3d4e5f6...'; // MD5 từ Apple
    console.log('Đang xác minh tính toàn vẹn firmware...');
    try {
        const actualMd5 = await createMd5(filePath, {
            onProgress: (info) => {
                console.log(`Tiến độ: ${info.percent.toFixed(1)}%`);
            }
        });
        console.log('\n');
        if (actualMd5 === expectedMd5) {
            console.log('✓ File firmware hợp lệ và nguyên vẹn');
        }
        else {
            console.log('✗ CẢNH BÁO: File có thể bị hỏng hoặc giả mạo!');
            console.log(`  Mong đợi: ${expectedMd5}`);
            console.log(`  Thực tế:  ${actualMd5}`);
        }
    }
    catch (error) {
        console.error('Lỗi:', error);
    }
}
