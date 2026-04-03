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
exports.checkRangeSupport = checkRangeSupport;
exports.buildParts = buildParts;
exports.getExistingBytes = getExistingBytes;
exports.downloadPart = downloadPart;
exports.downloadSingleStream = downloadSingleStream;
const undici_1 = require("undici");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Nếu không nhận được chunk nào trong khoảng này → coi như stall/mất mạng
const CHUNK_TIMEOUT_MS = 8_000;
const agent = new undici_1.Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 300_000,
    connections: 64,
    pipelining: 1,
});
/**
 * Check Range support.
 * Attempt 1: HEAD
 * Attempt 2: GET bytes=0-0 probe (nhiều CDN bỏ qua HEAD nhưng vẫn hỗ trợ Range)
 */
async function checkRangeSupport(url, signal) {
    try {
        const res = await (0, undici_1.fetch)(url, {
            method: "HEAD",
            headers: { "User-Agent": "Mozilla/5.0 (compatible; DownloadManager/1.0)" },
            // @ts-ignore
            dispatcher: agent,
            signal: signal ?? AbortSignal.timeout(10_000),
        });
        const result = extractRangeInfo(res.headers, res.status);
        if (result.supportsRange)
            return result;
    }
    catch {
        // fall through
    }
    try {
        const res = await (0, undici_1.fetch)(url, {
            method: "GET",
            headers: {
                Range: "bytes=0-0",
                "User-Agent": "Mozilla/5.0 (compatible; DownloadManager/1.0)",
            },
            // @ts-ignore
            dispatcher: agent,
            signal: signal ?? AbortSignal.timeout(10_000),
        });
        await res.body?.cancel();
        if (res.status === 206) {
            const contentRange = res.headers.get("content-range") ?? "";
            const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/);
            const fileSize = match ? parseInt(match[1], 10) : 0;
            return extractRangeInfo(res.headers, res.status, fileSize);
        }
    }
    catch {
        // ignore
    }
    return { supportsRange: false, fileSize: 0 };
}
function extractRangeInfo(headers, status, overrideSize) {
    const acceptRanges = headers.get("accept-ranges");
    const contentLength = headers.get("content-length");
    const contentType = headers.get("content-type") ?? undefined;
    const disposition = headers.get("content-disposition") ?? "";
    const fileSize = overrideSize ?? (contentLength ? parseInt(contentLength, 10) : 0);
    const supportsRange = (acceptRanges === "bytes" || status === 206) &&
        !isNaN(fileSize) &&
        fileSize > 0;
    let fileName;
    const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n\r]+)/i);
    if (fnMatch)
        fileName = decodeURIComponent(fnMatch[1].trim());
    return { supportsRange, fileSize, contentType, fileName };
}
/**
 * Split fileSize thành numParts non-overlapping ranges.
 * Dùng Math.floor — part cuối nhận phần còn lại → tổng luôn == fileSize.
 */
function buildParts(fileSize, numParts, tempDir) {
    const parts = [];
    const chunkSize = Math.floor(fileSize / numParts);
    for (let i = 0; i < numParts; i++) {
        const startBytes = i * chunkSize;
        const endBytes = i === numParts - 1 ? fileSize - 1 : startBytes + chunkSize - 1;
        parts.push({
            index: i,
            startBytes,
            endBytes,
            progress: 0,
            downloaded: 0,
            tempFile: path.join(tempDir, `part_${i}.tmp`),
            done: false,
        });
    }
    return parts;
}
function getExistingBytes(filePath) {
    try {
        return fs.statSync(filePath).size;
    }
    catch {
        return 0;
    }
}
/**
 * Download một part bằng HTTP Range.
 *
 * Fix quan trọng:
 * - AbortController được expose qua onAbortController callback.
 *   Manager gọi ac.abort() ngay khi pause/cancel → reader.read() throw
 *   ngay lập tức, không cần chờ chunk tiếp theo từ server.
 */
async function downloadPart(url, part, callbacks, retries = 4) {
    if (part.done) {
        callbacks.onDone(part);
        return;
    }
    for (let attempt = 0; attempt < retries; attempt++) {
        if (callbacks.isCancelled())
            return;
        const existingOnDisk = getExistingBytes(part.tempFile);
        const partTotal = part.endBytes - part.startBytes + 1;
        const resumeFrom = part.startBytes + existingOnDisk;
        if (existingOnDisk >= partTotal) {
            part.downloaded = partTotal;
            part.progress = 100;
            part.done = true;
            callbacks.onDone(part);
            return;
        }
        part.downloaded = existingOnDisk;
        // ── Tạo AbortController MỚI cho mỗi attempt, expose ngay cho manager ──────
        const ac = new AbortController();
        callbacks.onAbortController(ac);
        try {
            const res = await (0, undici_1.fetch)(url, {
                headers: {
                    Range: `bytes=${resumeFrom}-${part.endBytes}`,
                    "User-Agent": "Mozilla/5.0 (compatible; DownloadManager/1.0)",
                },
                // @ts-ignore
                dispatcher: agent,
                signal: ac.signal,
            });
            if (res.status === 416) {
                part.downloaded = partTotal;
                part.progress = 100;
                part.done = true;
                await res.body?.cancel();
                callbacks.onDone(part);
                return;
            }
            if (res.status !== 206 && res.status !== 200) {
                await res.body?.cancel();
                throw new Error(`HTTP ${res.status}`);
            }
            if (!res.body)
                throw new Error("No response body");
            const ws = existingOnDisk > 0
                ? fs.createWriteStream(part.tempFile, { flags: "r+", start: existingOnDisk })
                : fs.createWriteStream(part.tempFile, { flags: "w" });
            const reader = res.body.getReader();
            let streamError = null;
            try {
                while (true) {
                    if (callbacks.isCancelled() || callbacks.isPaused()) {
                        ac.abort();
                        break;
                    }
                    // ── Chunk timeout: nếu không có data trong CHUNK_TIMEOUT_MS
                    //    thì abort luôn (xử lý TCP buffer stall khi mất mạng).
                    //    Kết hợp với ac.signal để pause/cancel vẫn thắng.
                    let readResult;
                    try {
                        readResult = await readWithTimeout(reader, CHUNK_TIMEOUT_MS, ac.signal);
                    }
                    catch (readErr) {
                        const name = readErr?.name;
                        // AbortError  = pause/cancel chủ động → thoát sạch
                        // TimeoutError = không có data quá lâu → throw để retry
                        if (name === "AbortError")
                            break;
                        throw readErr; // TimeoutError hoặc lỗi mạng thật → retry
                    }
                    if (readResult.done)
                        break;
                    const value = readResult.value;
                    if (!value || value.byteLength === 0)
                        continue;
                    const remaining = partTotal - part.downloaded;
                    if (remaining <= 0)
                        break;
                    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
                    await new Promise((resolve, reject) => ws.write(chunk, (err) => (err ? reject(err) : resolve())));
                    part.downloaded += chunk.byteLength;
                    part.progress = Math.min(100, Math.round((part.downloaded / partTotal) * 100));
                    callbacks.onProgress(part, chunk.byteLength);
                }
            }
            catch (e) {
                streamError = e;
            }
            finally {
                reader.releaseLock();
                await new Promise((r) => ws.end(r));
            }
            if (streamError)
                throw streamError;
            // Bị abort chủ động → thoát sạch, không retry
            if (callbacks.isCancelled() || callbacks.isPaused())
                return;
            const finalOnDisk = getExistingBytes(part.tempFile);
            if (finalOnDisk >= partTotal) {
                part.downloaded = partTotal;
                part.progress = 100;
                part.done = true;
                callbacks.onDone(part);
                return;
            }
            throw new Error(`Incomplete: ${finalOnDisk} / ${partTotal} bytes`);
        }
        catch (err) {
            if (callbacks.isCancelled() || callbacks.isPaused())
                return;
            if (err?.name === "AbortError")
                return;
            if (attempt === retries - 1) {
                callbacks.onError(part, err);
                return;
            }
            await sleep(Math.min(1000 * 2 ** attempt, 16_000));
        }
    }
}
/**
 * Download không có Range (single stream).
 */
async function downloadSingleStream(url, destFile, callbacks) {
    const ac = new AbortController();
    callbacks.onAbortController(ac);
    try {
        const res = await (0, undici_1.fetch)(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; DownloadManager/1.0)" },
            // @ts-ignore
            dispatcher: agent,
            signal: ac.signal,
        });
        if (!res.body || !res.ok)
            throw new Error(`HTTP ${res.status}`);
        const total = parseInt(res.headers.get("content-length") ?? "0", 10);
        const ws = fs.createWriteStream(destFile, { flags: "w" });
        const reader = res.body.getReader();
        let downloaded = 0;
        try {
            while (true) {
                if (callbacks.isCancelled() || callbacks.isPaused()) {
                    ac.abort();
                    break;
                }
                let readResult;
                try {
                    readResult = await readWithTimeout(reader, CHUNK_TIMEOUT_MS, ac.signal);
                }
                catch (e) {
                    if (e?.name === "AbortError")
                        break;
                    throw e;
                }
                if (readResult.done)
                    break;
                const value = readResult.value;
                await new Promise((resolve, reject) => ws.write(value, (err) => (err ? reject(err) : resolve())));
                downloaded += value.byteLength;
                callbacks.onProgress(downloaded, total);
            }
        }
        finally {
            reader.releaseLock();
            await new Promise((r) => ws.end(r));
        }
        if (!callbacks.isCancelled() && !callbacks.isPaused()) {
            callbacks.onDone();
        }
    }
    catch (err) {
        if (err?.name === "AbortError")
            return;
        if (!callbacks.isCancelled())
            callbacks.onError(err);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Bao bọc reader.read() với timeout + abort signal.
 *
 * - Nếu ac.signal bị abort (pause/cancel) → reject AbortError ngay
 * - Nếu không có data sau TIMEOUT ms         → reject TimeoutError
 *   (xử lý TCP buffer stall: buffer đã drain, mạng không gửi thêm)
 */
function readWithTimeout(reader, timeoutMs, abortSignal) {
    return new Promise((resolve, reject) => {
        let timer = null;
        let settled = false;
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            abortSignal.removeEventListener("abort", onAbort);
            fn();
        };
        const onAbort = () => {
            settle(() => reject(Object.assign(new Error("AbortError"), { name: "AbortError" })));
        };
        // Nếu signal đã abort trước khi gọi
        if (abortSignal.aborted) {
            return reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
            settle(() => reject(Object.assign(new Error("Chunk timeout — no data received"), { name: "TimeoutError" })));
        }, timeoutMs);
        reader.read().then((result) => settle(() => resolve(result)), (err) => settle(() => reject(err)));
    });
}
