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
exports.IntegrityChecker = void 0;
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
class IntegrityChecker {
    /**
     * Compute hash of a file using streaming (memory-efficient for large files)
     */
    async computeHash(filePath, algo) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash(algo);
            const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 }); // 64MB chunks
            stream.on("data", chunk => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
            stream.on("error", reject);
        });
    }
    /**
     * Verify firmware integrity — tries sha256 → sha1 → md5 in order
     */
    async verify(filePath, firmware, onProgress) {
        const checks = [];
        // Priority: md5 (fastest for large files) → sha1 → sha256
        if (firmware.md5sum)
            checks.push({ algo: "md5", expected: firmware.md5sum });
        if (firmware.sha1sum)
            checks.push({ algo: "sha1", expected: firmware.sha1sum });
        if (firmware.sha256sum)
            checks.push({ algo: "sha256", expected: firmware.sha256sum });
        if (checks.length === 0) {
            return { ok: true, algo: null, expected: "", actual: "" };
        }
        // Use best available hash
        const { algo, expected } = checks[0];
        const fileSize = fs.statSync(filePath).size;
        let processed = 0;
        const startedAt = Date.now();
        const actual = await new Promise((resolve, reject) => {
            const hash = crypto.createHash(algo);
            const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 });
            stream.on("data", (chunk) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                hash.update(buf);
                processed += buf.length;
                if (onProgress && fileSize > 0) {
                    const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
                    const speed = processed / elapsedSec;
                    const eta = speed > 0 ? Math.round((fileSize - processed) / speed) : undefined;
                    onProgress({ pct: Math.floor((processed / fileSize) * 100), speed, eta });
                }
            });
            stream.on("end", () => resolve(hash.digest("hex")));
            stream.on("error", reject);
        });
        return {
            ok: actual.toLowerCase() === expected.toLowerCase(),
            algo,
            expected: expected.toLowerCase(),
            actual: actual.toLowerCase(),
        };
    }
}
exports.IntegrityChecker = IntegrityChecker;
