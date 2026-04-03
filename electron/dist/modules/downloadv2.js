"use strict";
/**
 * DownloadManager v4
 * IDM-level download engine — pure TypeScript + Node.js
 * Optimized for Apple IPSW files (2 GB – 12 GB+)
 *
 * Architecture:
 *  • Pre-allocate a single .dltmp file → each chunk writes at its exact byte offset
 *  • No merge step → atomic rename tmp → final
 *  • .dlmeta file tracks per-chunk state for byte-perfect resume
 *  • optimizeForHDD: serializes finalize operations so HDD is never written
 *    to by two tasks simultaneously
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadManager = void 0;
const undici_1 = require("undici");
const fs_1 = require("fs");
const fs_2 = require("fs");
const path_1 = require("path");
const uuid_1 = require("uuid");
const os_1 = __importDefault(require("os"));
const promises_1 = __importDefault(require("dns/promises"));
const disk_1 = require("./disk");
// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const APPLE_URL_REGEX = /^https?:\/\/(([a-z0-9\-]+\.)*apple\.com|([a-z0-9\-]+\.)*cdn-apple\.com)\//i;
const REQUIRED_FREE_BUFFER_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB headroom
const META_DIR = (0, path_1.join)(os_1.default.tmpdir(), '.dl_meta');
const TMP_DIR_BASE = (0, path_1.join)(os_1.default.tmpdir(), '.dl_tmp');
const META_EXT = '.dlmeta';
const TMP_EXT = '.dltmp';
const PROGRESS_INTERVAL_MS = 500;
// Apple IPSW: 64 MB chunks → ~167 chunks for a 10 GB file (IDM-level granularity)
const DEFAULT_CHUNK_SIZE_MB = 16;
const APPLE_CHUNK_SIZE_MB = 64;
const MIN_CHUNK_SIZE_MB = 4;
const SLOW_SPEED_THRESHOLD_BPS = 512 * 1024; // 512 KB/s
const SLOW_SPEED_WINDOW_MS = 2000;
const DEFAULT_MAX_CONNECTIONS = 4;
const APPLE_MAX_CONNECTIONS = 24;
// ─────────────────────────────────────────────────────────────────────────────
// DISK HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function isDiskSSD(targetPath) {
    try {
        const p = os_1.default.platform();
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        if (p === 'win32') {
            const out = execSync(`powershell "Get-PhysicalDisk | Where-Object {$_.MediaType -eq 'SSD'} | Measure-Object | Select-Object -ExpandProperty Count"`, { encoding: 'utf8' });
            return parseInt(out.trim(), 10) > 0;
        }
        else if (p === 'linux') {
            const out = execSync(`df "${targetPath}" | tail -1 | awk '{print $1}'`, {
                encoding: 'utf8',
            }).trim();
            const dev = out.replace(/^\/dev\//, '').replace(/[0-9]+$/, '');
            const rot = await fs_2.promises
                .readFile(`/sys/block/${dev}/queue/rotational`, 'utf8')
                .catch(() => '1');
            return rot.trim() === '0';
        }
        else if (p === 'darwin') {
            const out = execSync(`diskutil info / | grep "Solid State"`, { encoding: 'utf8' });
            return out.toLowerCase().includes('yes');
        }
        return true;
    }
    catch {
        return true;
    }
}
async function findAlternateSSD(requiredBytes, excludePath) {
    const p = os_1.default.platform();
    const candidates = p === 'win32'
        ? ['C:\\', 'D:\\', 'E:\\', 'F:\\']
        : p === 'darwin'
            ? [os_1.default.homedir(), '/tmp']
            : [os_1.default.homedir(), '/tmp', '/mnt'];
    for (const c of candidates) {
        if (!(0, fs_1.existsSync)(c) || c === excludePath)
            continue;
        try {
            if (!(await isDiskSSD(c)))
                continue;
            const disk = (0, disk_1.getDiskSpace)(c);
            if (disk.available >= requiredBytes)
                return c;
        }
        catch {
            continue;
        }
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────
// META PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
function getMetaPath(downloadId) {
    return (0, path_1.join)(META_DIR, `${downloadId}${META_EXT}`);
}
async function saveMeta(meta) {
    (0, fs_1.mkdirSync)(META_DIR, { recursive: true });
    await fs_2.promises.writeFile(getMetaPath(meta.downloadId), JSON.stringify(meta, null, 2), 'utf8');
}
async function loadMeta(downloadId) {
    try {
        const raw = await fs_2.promises.readFile(getMetaPath(downloadId), 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function deleteMeta(downloadId) {
    try {
        await fs_2.promises.unlink(getMetaPath(downloadId));
    }
    catch { }
}
async function listAllMeta() {
    (0, fs_1.mkdirSync)(META_DIR, { recursive: true });
    const files = await fs_2.promises.readdir(META_DIR).catch(() => []);
    const metas = [];
    for (const f of files) {
        if (!f.endsWith(META_EXT))
            continue;
        try {
            const raw = await fs_2.promises.readFile((0, path_1.join)(META_DIR, f), 'utf8');
            metas.push(JSON.parse(raw));
        }
        catch { }
    }
    return metas;
}
// ─────────────────────────────────────────────────────────────────────────────
// FILE ALLOCATION
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Pre-allocate a sparse file of exactly `size` bytes.
 * Writing a single zero byte at (size - 1) sets the EOF without filling every
 * block, completing instantly even for 12 GB files.
 */
async function preallocateFile(filePath, size) {
    (0, fs_1.mkdirSync)((0, path_1.dirname)(filePath), { recursive: true });
    const fh = await fs_2.promises.open(filePath, 'w+');
    if (size > 0) {
        await fh.write(Buffer.alloc(1, 0), 0, 1, size - 1);
    }
    return fh;
}
async function openExistingFile(filePath) {
    return fs_2.promises.open(filePath, 'r+');
}
// ─────────────────────────────────────────────────────────────────────────────
// CHUNK BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildChunks(totalSize, chunkSizeMB) {
    const chunkSize = chunkSizeMB * 1024 * 1024;
    const chunks = [];
    let offset = 0;
    let index = 0;
    while (offset < totalSize) {
        const end = Math.min(offset + chunkSize - 1, totalSize - 1);
        chunks.push({
            index,
            start: offset,
            end,
            downloaded: 0,
            state: 'pending',
            retries: 0,
            speedHistory: [],
        });
        offset = end + 1;
        index++;
    }
    return chunks;
}
// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD MANAGER
// ─────────────────────────────────────────────────────────────────────────────
class DownloadManager {
    mainWindow;
    internet;
    activeTasks = new Map();
    queuedTasks = [];
    downloadedFiles = new Set();
    maxConcurrentDownloads;
    /**
     * A promise chain used when optimizeForHDD is active.
     * Finalize operations are appended to the tail so only one rename/write
     * touches the HDD at a time.
     */
    hddFinalizeQueue = Promise.resolve();
    constructor(mainWindow, internet, maxConcurrent = 3) {
        this.mainWindow = mainWindow;
        this.internet = internet;
        this.maxConcurrentDownloads = maxConcurrent;
        (0, fs_1.mkdirSync)(META_DIR, { recursive: true });
        (0, fs_1.mkdirSync)(TMP_DIR_BASE, { recursive: true });
        this.internet.on('offline', () => this.handleNetworkLost());
        this.internet.on('online', () => this.handleNetworkRestored());
    }
    // ─────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────
    /**
     * Add a new download.
     * Returns the downloadId string on success, or a DownloadError object.
     */
    async add(request, options = {}) {
        if (!APPLE_URL_REGEX.test(request.url)) {
            return { errorType: 'INVALID_URL', message: 'Only Apple CDN URLs are allowed.' };
        }
        const key = this.fileKey(request);
        if (this.downloadedFiles.has(key))
            return { errorType: 'ALREADY_DOWNLOADED' };
        if (this.isActivelyDownloading(request))
            return { errorType: 'ALREADY_DOWNLOADING' };
        if (request.priority) {
            this.removeFromQueue(request);
            if (this.activeTasks.size >= this.maxConcurrentDownloads) {
                const victim = this.findNonPriorityTask();
                if (victim)
                    await this.pauseAndQueue(victim);
            }
            return this.startNewTask(request, options);
        }
        if (this.activeTasks.size >= this.maxConcurrentDownloads) {
            if (this.queuedTasks.some(t => this.isSameFile(t.request, request))) {
                return { errorType: 'QUEUED' };
            }
            this.queuedTasks.push({ request, options });
            return { errorType: 'QUEUED' };
        }
        return this.startNewTask(request, options);
    }
    pause(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task || task.paused || task.cancelled)
            return;
        this.pauseTask(task, false);
    }
    resume(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task || !task.paused || task.cancelled)
            return;
        task.paused = false;
        task.pausedByNetwork = false;
        task.progress.status = 'downloading';
        this.sendProgress(task);
        this.runEngine(task);
    }
    cancel(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task)
            return;
        task.cancelled = true;
        task.activeChunks.forEach(c => c.controller.abort());
        task.activeChunks.clear();
        if (task.progressTimer)
            clearInterval(task.progressTimer);
        if (task.fileHandle)
            task.fileHandle.close().catch(() => { });
        task.progress.status = 'cancelled';
        this.sendProgress(task);
        this.cleanupTaskFiles(task).catch(() => { });
        this.activeTasks.delete(downloadId);
        this.processQueue();
    }
    /**
     * Returns all downloads that have a .dlmeta file and are not yet finalized.
     * Useful for showing the user which downloads can be resumed after a restart.
     */
    async getIncompleteDownloads() {
        const metas = await listAllMeta();
        return metas
            .filter(m => !m.finalized)
            .map(m => {
            const downloadedSize = m.chunks.reduce((s, c) => s + c.downloaded, 0);
            return {
                downloadId: m.downloadId,
                fileName: m.fileName,
                targetDir: m.targetDir,
                totalSize: m.totalSize,
                downloadedSize,
                progress: m.totalSize > 0 ? (downloadedSize / m.totalSize) * 100 : 0,
                metaPath: getMetaPath(m.downloadId),
                tmpFileExists: (0, fs_1.existsSync)(m.tmpFilePath),
            };
        });
    }
    /**
     * Resume a previously incomplete download by its downloadId.
     *
     * Behaviour:
     *  - If the pre-allocated tmp file is MISSING on disk → all chunk progress is
     *    discarded and the download restarts from byte 0 (fresh pre-allocation).
     *  - If the tmp file EXISTS → each chunk's recorded byte count is validated;
     *    any chunk with a mismatched count is reset before resuming.
     */
    async resumeIncomplete(downloadId, options = {}) {
        const meta = await loadMeta(downloadId);
        if (!meta) {
            return {
                errorType: 'NETWORK',
                message: `No metadata found for downloadId "${downloadId}"`,
            };
        }
        if (meta.finalized)
            return { errorType: 'ALREADY_DOWNLOADED' };
        if (this.activeTasks.has(downloadId))
            return { errorType: 'ALREADY_DOWNLOADING' };
        if (!(0, fs_1.existsSync)(meta.tmpFilePath)) {
            // Tmp file is gone — full reset, startTaskFromMeta will re-preallocate
            console.log(`[Resume] Tmp file missing for "${meta.fileName}" — restarting from scratch`);
            for (const c of meta.chunks) {
                c.downloaded = 0;
                c.state = 'pending';
                c.retries = 0;
                c.speedHistory = [];
            }
            await saveMeta(meta);
        }
        else {
            // Validate chunk metadata against expected sizes
            await this.validateAndRepairChunkMeta(meta);
        }
        return this.startTaskFromMeta(meta, options);
    }
    getActiveDownloads() {
        return Array.from(this.activeTasks.values()).map(t => t.progress);
    }
    clearDownloadedFile(filePath, fileName) {
        this.downloadedFiles.delete(`${filePath}/${fileName}`);
    }
    cleanup() {
        this.activeTasks.forEach(t => this.cancel(t.id));
    }
    // ─────────────────────────────────────────────
    // TASK STARTUP
    // ─────────────────────────────────────────────
    async startNewTask(request, options) {
        // 1. Resolve final URL + content-length via HEAD
        let headResult;
        try {
            headResult = await this.resolveFileInfo(request.url, options.maxRedirects ?? 10);
        }
        catch (err) {
            return { errorType: 'NETWORK', message: String(err) };
        }
        const { finalUrl, contentLength } = headResult;
        // 2. Validate disk space
        try {
            const disk = (0, disk_1.getDiskSpace)(request.path);
            if (disk.available < contentLength + REQUIRED_FREE_BUFFER_BYTES) {
                return {
                    errorType: 'DISKFULL',
                    message: `Need at least ${(0, disk_1.formatBytes)(contentLength + REQUIRED_FREE_BUFFER_BYTES)} free.`,
                };
            }
        }
        catch {
            return { errorType: 'DISKFULL', message: 'Cannot determine available disk space.' };
        }
        // 3. Pick tmp location (prefer SSD for faster random writes during download)
        const targetIsSSD = await isDiskSSD(request.path);
        let tmpBase = TMP_DIR_BASE;
        if (!targetIsSSD) {
            const altSSD = await findAlternateSSD(contentLength + REQUIRED_FREE_BUFFER_BYTES, request.path);
            if (altSSD)
                tmpBase = (0, path_1.join)(altSSD, '.dl_tmp');
        }
        const downloadId = (0, uuid_1.v4)();
        const tmpFilePath = (0, path_1.join)(tmpBase, `${downloadId}${TMP_EXT}`);
        (0, fs_1.mkdirSync)((0, path_1.dirname)(tmpFilePath), { recursive: true });
        // 4. DNS multi-IP for Apple CDN
        const isApple = APPLE_URL_REGEX.test(finalUrl);
        let resolvedIPs = [];
        if (isApple) {
            try {
                resolvedIPs = await promises_1.default.resolve4(new URL(finalUrl).hostname);
            }
            catch { }
        }
        // 5. Build chunk plan
        const chunkSizeMB = isApple ? APPLE_CHUNK_SIZE_MB : DEFAULT_CHUNK_SIZE_MB;
        const chunks = buildChunks(contentLength, chunkSizeMB);
        const meta = {
            downloadId,
            originalUrl: request.url,
            finalUrl,
            totalSize: contentLength,
            tmpFilePath,
            targetDir: request.path,
            fileName: request.fileName,
            chunks,
            createdAt: Date.now(),
            finalized: false,
        };
        await saveMeta(meta);
        return this.startTaskFromMeta(meta, options, request, resolvedIPs);
    }
    async startTaskFromMeta(meta, options, request, resolvedIPs) {
        const isApple = APPLE_URL_REGEX.test(meta.finalUrl);
        let ips = resolvedIPs ?? [];
        if (isApple && ips.length === 0) {
            try {
                ips = await promises_1.default.resolve4(new URL(meta.finalUrl).hostname);
            }
            catch { }
        }
        const req = request ?? {
            url: meta.originalUrl,
            path: meta.targetDir,
            fileName: meta.fileName,
        };
        // Open or create the pre-allocated tmp file
        let fileHandle;
        try {
            if ((0, fs_1.existsSync)(meta.tmpFilePath)) {
                fileHandle = await openExistingFile(meta.tmpFilePath);
            }
            else {
                // Tmp file missing (e.g. /tmp cleared) — preallocate fresh and reset chunks
                fileHandle = await preallocateFile(meta.tmpFilePath, meta.totalSize);
                for (const c of meta.chunks) {
                    c.downloaded = 0;
                    c.state = 'pending';
                    c.retries = 0;
                    c.speedHistory = [];
                }
                await saveMeta(meta);
            }
        }
        catch (err) {
            return { errorType: 'NETWORK', message: `Cannot open tmp file: ${err}` };
        }
        const downloadedSize = meta.chunks.reduce((s, c) => s + c.downloaded, 0);
        const agent = new undici_1.Agent({
            keepAliveTimeout: 30_000,
            keepAliveMaxTimeout: 60_000,
            connections: isApple ? APPLE_MAX_CONNECTIONS : DEFAULT_MAX_CONNECTIONS,
        });
        const filePath = (0, path_1.join)(meta.targetDir, meta.fileName);
        const task = {
            id: meta.downloadId,
            request: req,
            options,
            meta,
            progress: {
                downloadId: meta.downloadId,
                fileName: meta.fileName,
                filePath,
                totalSize: meta.totalSize,
                downloadedSize,
                progress: meta.totalSize > 0 ? (downloadedSize / meta.totalSize) * 100 : 0,
                speed: 0,
                eta: 0,
                status: 'downloading',
                parts: meta.chunks.map(c => ({
                    index: c.index,
                    state: c.state,
                    speed: 0,
                    downloaded: c.downloaded,
                    total: c.end - c.start + 1,
                })),
                isApple,
            },
            activeChunks: new Map(),
            paused: false,
            cancelled: false,
            pausedByNetwork: false,
            isApple,
            resolvedIPs: ips,
            maxConnections: isApple ? APPLE_MAX_CONNECTIONS : DEFAULT_MAX_CONNECTIONS,
            currentChunkSizeMB: isApple ? APPLE_CHUNK_SIZE_MB : DEFAULT_CHUNK_SIZE_MB,
            speedSamples: [],
            lastProgressTime: Date.now(),
            lastProgressBytes: downloadedSize,
            agent,
            fileHandle,
            engineRunning: false,
        };
        this.activeTasks.set(meta.downloadId, task);
        this.startProgressReporter(task);
        this.runEngine(task);
        return meta.downloadId;
    }
    // ─────────────────────────────────────────────
    // ENGINE LOOP
    // ─────────────────────────────────────────────
    async runEngine(task) {
        if (task.engineRunning)
            return;
        task.engineRunning = true;
        try {
            while (!task.cancelled && !task.paused) {
                const pending = task.meta.chunks.filter(c => c.state !== 'done' && !task.activeChunks.has(c.index));
                const allDone = pending.length === 0 && task.activeChunks.size === 0;
                if (allDone) {
                    // ── Strict total byte-count verification ────────────────────────
                    const totalWritten = task.meta.chunks.reduce((s, c) => s + c.downloaded, 0);
                    if (totalWritten !== task.meta.totalSize) {
                        this.handleTaskError(task, `Byte count mismatch before finalize: expected ${task.meta.totalSize}, got ${totalWritten}`);
                        return;
                    }
                    await this.finalizeDownload(task);
                    return;
                }
                const target = this.computeTargetConnections(task);
                const slots = target - task.activeChunks.size;
                if (slots > 0 && pending.length > 0) {
                    for (const chunk of pending.slice(0, slots)) {
                        chunk.state = 'active';
                        this.spawnChunkWorker(task, chunk);
                    }
                }
                else if (slots > 0 && pending.length === 0 && task.activeChunks.size > 0) {
                    this.rebalanceSlowest(task);
                }
                await sleep(150);
            }
        }
        finally {
            task.engineRunning = false;
        }
    }
    spawnChunkWorker(task, chunk) {
        const controller = new AbortController();
        task.activeChunks.set(chunk.index, { meta: chunk, controller });
        this.downloadChunk(task, chunk, controller)
            .then(async () => {
            task.activeChunks.delete(chunk.index);
            await saveMeta(task.meta).catch(() => { });
            if (!task.engineRunning && !task.cancelled && !task.paused) {
                this.runEngine(task);
            }
        })
            .catch(async (err) => {
            task.activeChunks.delete(chunk.index);
            if (task.cancelled || task.paused)
                return;
            const msg = String(err).toLowerCase();
            if (msg.includes('aborterror') || msg.includes('abort')) {
                chunk.state = 'pending';
                return;
            }
            console.warn(`[Chunk ${chunk.index}] Error: ${err}`);
            chunk.retries++;
            chunk.state = 'error';
            if (chunk.retries > 10) {
                this.handleTaskError(task, `Chunk ${chunk.index} failed after ${chunk.retries} retries`);
                return;
            }
            if (chunk.retries > 3 && task.currentChunkSizeMB > MIN_CHUNK_SIZE_MB) {
                task.currentChunkSizeMB = Math.max(MIN_CHUNK_SIZE_MB, task.currentChunkSizeMB / 2);
                console.log(`[Adaptive] Reduced chunk size → ${task.currentChunkSizeMB} MB`);
            }
            chunk.state = 'pending';
            await sleep(Math.min(1000 * chunk.retries, 8000));
            if (!task.cancelled && !task.paused && !task.engineRunning) {
                this.runEngine(task);
            }
        });
    }
    // ─────────────────────────────────────────────
    // CHUNK DOWNLOAD
    // ─────────────────────────────────────────────
    async downloadChunk(task, chunk, controller) {
        if (!task.fileHandle)
            throw new Error('File handle is not open');
        const expectedBytes = chunk.end - chunk.start + 1;
        // Already fully downloaded (from a valid resumed state)
        if (chunk.downloaded >= expectedBytes) {
            this.verifyChunkBytes(chunk);
            return;
        }
        // ── HTTP Range: resume from exactly where we stopped ────────────────
        const resumeFrom = chunk.start + chunk.downloaded;
        const rangeEnd = chunk.end;
        const url = this.resolveChunkUrl(task, chunk);
        const headers = {
            Range: `bytes=${resumeFrom}-${rangeEnd}`,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
            Accept: '*/*',
            Connection: 'keep-alive',
        };
        const response = await (0, undici_1.fetch)(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
            dispatcher: task.agent,
        });
        if (response.status !== 206 && response.status !== 200) {
            throw new Error(`HTTP ${response.status} for chunk ${chunk.index}`);
        }
        if (!response.body)
            throw new Error('Empty response body');
        // ── Slow-connection watchdog ─────────────────────────────────────────
        let slowTimer = null;
        let slowCheckBytes = chunk.downloaded;
        let slowCheckTime = Date.now();
        const armSlowTimer = () => {
            if (slowTimer)
                clearTimeout(slowTimer);
            slowTimer = setTimeout(() => {
                const elapsed = (Date.now() - slowCheckTime) / 1000;
                if (elapsed > 0) {
                    const bps = (chunk.downloaded - slowCheckBytes) / elapsed;
                    if (bps < SLOW_SPEED_THRESHOLD_BPS && chunk.retries < 5) {
                        console.log(`[SlowDetect] Chunk ${chunk.index}: ${(0, disk_1.formatBytes)(bps)}/s — aborting & retrying`);
                        controller.abort();
                    }
                }
            }, SLOW_SPEED_WINDOW_MS);
        };
        let lastSpeedTime = Date.now();
        let lastSpeedBytes = chunk.downloaded;
        const reader = response.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (controller.signal.aborted)
                    break;
                if (!value || value.length === 0)
                    continue;
                // ── Write at the exact byte offset in the pre-allocated file ────
                // chunk.start = absolute byte position in the final file.
                // chunk.downloaded = bytes already written for this chunk.
                // → writeOffset is always correct, even after rebalancing because
                //   rebalanced sub-chunks have start set to the new HTTP range start
                //   which is identical to their file write offset.
                const writeOffset = chunk.start + chunk.downloaded;
                await task.fileHandle.write(value, 0, value.length, writeOffset);
                chunk.downloaded += value.length;
                // Speed sample every ~300 ms
                const now = Date.now();
                const dt = (now - lastSpeedTime) / 1000;
                if (dt >= 0.3) {
                    const bps = (chunk.downloaded - lastSpeedBytes) / dt;
                    chunk.speedHistory.push(bps);
                    if (chunk.speedHistory.length > 10)
                        chunk.speedHistory.shift();
                    lastSpeedTime = now;
                    lastSpeedBytes = chunk.downloaded;
                    slowCheckBytes = chunk.downloaded;
                    slowCheckTime = now;
                    armSlowTimer();
                }
                // Update aggregate downloaded counter for progress reporting
                task.progress.downloadedSize =
                    task.meta.chunks.reduce((s, c) => s + c.downloaded, 0);
            }
        }
        finally {
            if (slowTimer)
                clearTimeout(slowTimer);
            reader.releaseLock();
        }
        if (!controller.signal.aborted) {
            this.verifyChunkBytes(chunk);
        }
    }
    // ─────────────────────────────────────────────
    // CHUNK VERIFICATION
    // ─────────────────────────────────────────────
    /**
     * Strict byte-count check for a finished chunk.
     * On mismatch: resets downloaded to 0 and throws so the worker retries.
     */
    verifyChunkBytes(chunk) {
        const expected = chunk.end - chunk.start + 1;
        if (chunk.downloaded !== expected) {
            const actual = chunk.downloaded;
            chunk.downloaded = 0; // reset so retry starts from the correct sub-offset
            chunk.state = 'pending';
            throw new Error(`Chunk ${chunk.index} byte mismatch: expected ${expected}, got ${actual} — resetting`);
        }
        chunk.state = 'done';
    }
    /**
     * On resume, cross-check every chunk's recorded byte count against the
     * expected size derived from its start/end range.
     * Also resets any chunk that was stuck in 'active' state when the app closed.
     */
    async validateAndRepairChunkMeta(meta) {
        let changed = false;
        for (const chunk of meta.chunks) {
            const expected = chunk.end - chunk.start + 1;
            // Chunk marked done but downloaded count is wrong
            if (chunk.state === 'done' && chunk.downloaded !== expected) {
                console.warn(`[Validate] Chunk ${chunk.index}: expected ${expected} bytes, ` +
                    `metadata has ${chunk.downloaded} — resetting`);
                chunk.downloaded = 0;
                chunk.state = 'pending';
                changed = true;
            }
            // Chunk was mid-flight when the app closed
            if (chunk.state === 'active') {
                chunk.state = 'pending';
                changed = true;
            }
        }
        if (changed)
            await saveMeta(meta);
    }
    // ─────────────────────────────────────────────
    // FINALIZE: rename tmp → final
    // ─────────────────────────────────────────────
    async finalizeDownload(task) {
        if (task.progressTimer)
            clearInterval(task.progressTimer);
        task.progress.status = 'finalizing';
        task.progress.progress = 100;
        task.progress.downloadedSize = task.meta.totalSize;
        task.progress.speed = 0;
        task.progress.eta = 0;
        this.sendProgress(task);
        const doFinalize = async () => {
            try {
                // Flush OS write-buffers, then close before rename
                if (task.fileHandle) {
                    await task.fileHandle.sync().catch(() => { });
                    await task.fileHandle.close();
                    task.fileHandle = undefined;
                }
                const finalPath = (0, path_1.join)(task.meta.targetDir, task.meta.fileName);
                (0, fs_1.mkdirSync)(task.meta.targetDir, { recursive: true });
                // Atomic rename — no data is copied
                (0, fs_1.renameSync)(task.meta.tmpFilePath, finalPath);
                // ── Final file-size verification ──────────────────────────────
                const stat = await fs_2.promises.stat(finalPath);
                if (stat.size !== task.meta.totalSize) {
                    throw new Error(`Final file size mismatch: expected ${task.meta.totalSize} bytes, ` +
                        `got ${stat.size} bytes`);
                }
                task.meta.finalized = true;
                await saveMeta(task.meta);
                console.log(`[Finalize] ✓ ${task.meta.fileName} — ${(0, disk_1.formatBytes)(stat.size)}`);
                this.handleTaskComplete(task, finalPath);
            }
            catch (err) {
                this.handleTaskError(task, `Finalize failed: ${err}`);
            }
        };
        if (task.options.optimizeForHDD) {
            // Serialize: append to the HDD finalize queue and await our turn
            this.hddFinalizeQueue = this.hddFinalizeQueue.then(doFinalize);
            await this.hddFinalizeQueue;
        }
        else {
            await doFinalize();
        }
    }
    // ─────────────────────────────────────────────
    // ADAPTIVE CONNECTION SCALING
    // ─────────────────────────────────────────────
    computeTargetConnections(task) {
        const s = task.speedSamples;
        if (s.length < 2)
            return Math.min(4, task.maxConnections);
        const recentAvg = avg(s.slice(-3));
        const prevAvg = s.length >= 6 ? avg(s.slice(-6, -3)) : recentAvg;
        const ratio = recentAvg / (prevAvg || 1);
        let target = task.activeChunks.size || 4;
        if (ratio > 1.1)
            target = Math.min(target + 4, task.maxConnections);
        else if (ratio < 0.8)
            target = Math.max(target - 2, 2);
        else
            target = Math.min(target + 1, task.maxConnections);
        return Math.max(2, Math.min(target, task.maxConnections));
    }
    // ─────────────────────────────────────────────
    // REBALANCING
    // ─────────────────────────────────────────────
    rebalanceSlowest(task) {
        let slowest = null;
        let lowestAvg = Infinity;
        task.activeChunks.forEach(({ meta: c }) => {
            if (c.speedHistory.length === 0)
                return;
            const a = avg(c.speedHistory);
            if (a < lowestAvg) {
                lowestAvg = a;
                slowest = c;
            }
        });
        if (!slowest)
            return;
        const chunk = slowest;
        const remaining = chunk.end - (chunk.start + chunk.downloaded);
        if (remaining < 8 * 1024 * 1024)
            return; // don't split chunks < 8 MB
        const mid = chunk.start + chunk.downloaded + Math.floor(remaining / 2);
        const originalEnd = chunk.end;
        chunk.end = mid - 1; // shrink the slow chunk's range
        // New sub-chunk: start = mid, which is also the write offset in the file
        const newChunk = {
            index: task.meta.chunks.length,
            start: mid,
            end: originalEnd,
            downloaded: 0,
            state: 'active',
            retries: 0,
            speedHistory: [],
        };
        task.meta.chunks.push(newChunk);
        console.log(`[Rebalance] Split chunk ${chunk.index} → new chunk ${newChunk.index} at byte ${mid}`);
        this.spawnChunkWorker(task, newChunk);
    }
    // ─────────────────────────────────────────────
    // PROGRESS REPORTING
    // ─────────────────────────────────────────────
    startProgressReporter(task) {
        task.progressTimer = setInterval(() => {
            if (task.cancelled)
                return;
            const now = Date.now();
            const dt = (now - task.lastProgressTime) / 1000;
            const db = task.progress.downloadedSize - task.lastProgressBytes;
            if (dt > 0) {
                const speed = db / dt;
                task.speedSamples.push(speed);
                if (task.speedSamples.length > 20)
                    task.speedSamples.shift();
                task.progress.speed = speed;
                task.progress.eta = speed > 0
                    ? (task.progress.totalSize - task.progress.downloadedSize) / speed
                    : 0;
                task.progress.progress = task.progress.totalSize > 0
                    ? (task.progress.downloadedSize / task.progress.totalSize) * 100
                    : 0;
                task.lastProgressTime = now;
                task.lastProgressBytes = task.progress.downloadedSize;
            }
            task.progress.parts = task.meta.chunks.map(c => ({
                index: c.index,
                state: c.state,
                speed: c.speedHistory.length > 0 ? avg(c.speedHistory.slice(-3)) : 0,
                downloaded: c.downloaded,
                total: c.end - c.start + 1,
            }));
            this.sendProgress(task);
        }, PROGRESS_INTERVAL_MS);
    }
    // ─────────────────────────────────────────────
    // NETWORK EVENTS
    // ─────────────────────────────────────────────
    handleNetworkLost() {
        this.activeTasks.forEach(task => {
            if (!task.paused && !task.cancelled) {
                task.pausedByNetwork = true;
                this.pauseTask(task, true);
                this.mainWindow.webContents.send('download-network-lost', {
                    downloadId: task.id,
                    fileName: task.request.fileName,
                });
            }
        });
    }
    handleNetworkRestored() {
        this.activeTasks.forEach(task => {
            if (task.paused && task.pausedByNetwork) {
                task.paused = false;
                task.pausedByNetwork = false;
                task.progress.status = 'downloading';
                this.sendProgress(task);
                this.runEngine(task);
                this.mainWindow.webContents.send('download-network-restored', {
                    downloadId: task.id,
                    fileName: task.request.fileName,
                });
            }
        });
    }
    // ─────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────
    async resolveFileInfo(url, maxRedirects) {
        let current = url;
        for (let i = 0; i <= maxRedirects; i++) {
            const agent = new undici_1.Agent({ keepAliveTimeout: 10_000 });
            const res = await (0, undici_1.fetch)(current, {
                method: 'HEAD',
                dispatcher: agent,
                redirect: 'manual',
            });
            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get('location');
                if (!loc)
                    throw new Error('Redirect without Location header');
                current = loc.startsWith('http') ? loc : new URL(loc, current).toString();
                continue;
            }
            if (res.status !== 200)
                throw new Error(`HEAD returned HTTP ${res.status}`);
            const cl = res.headers.get('content-length');
            if (!cl)
                throw new Error('No Content-Length in HEAD response');
            return { finalUrl: current, contentLength: parseInt(cl, 10) };
        }
        throw new Error('Too many redirects');
    }
    resolveChunkUrl(task, chunk) {
        if (!task.isApple || task.resolvedIPs.length === 0)
            return task.meta.finalUrl;
        const ip = task.resolvedIPs[chunk.index % task.resolvedIPs.length];
        try {
            const u = new URL(task.meta.finalUrl);
            u.hostname = ip;
            return u.toString();
        }
        catch {
            return task.meta.finalUrl;
        }
    }
    pauseTask(task, byNetwork) {
        task.paused = true;
        if (byNetwork)
            task.pausedByNetwork = true;
        task.activeChunks.forEach(c => c.controller.abort());
        task.activeChunks.clear();
        task.progress.status = 'paused';
        saveMeta(task.meta).catch(() => { });
        this.sendProgress(task);
    }
    async pauseAndQueue(task) {
        this.pauseTask(task, false);
        this.queuedTasks.unshift({ request: task.request, options: task.options });
        if (task.fileHandle) {
            await task.fileHandle.close().catch(() => { });
            task.fileHandle = undefined;
        }
        this.activeTasks.delete(task.id);
    }
    handleTaskComplete(task, filePath) {
        if (task.progressTimer)
            clearInterval(task.progressTimer);
        task.progress.status = 'completed';
        task.progress.progress = 100;
        this.sendProgress(task);
        this.downloadedFiles.add(this.fileKey(task.request));
        this.mainWindow.webContents.send('download-complete', {
            downloadId: task.id,
            filePath,
            fileName: task.request.fileName,
            fileSize: task.progress.totalSize,
            request: task.request,
        });
        this.activeTasks.delete(task.id);
        this.processQueue();
    }
    handleTaskError(task, error) {
        if (task.cancelled)
            return;
        if (task.progressTimer)
            clearInterval(task.progressTimer);
        if (task.fileHandle)
            task.fileHandle.close().catch(() => { });
        task.progress.status = 'error';
        task.progress.error = error;
        this.sendProgress(task);
        console.error(`[Error] ${task.meta.fileName}: ${error}`);
        this.mainWindow.webContents.send('download-error', {
            downloadId: task.id,
            error,
            request: task.request,
        });
        this.activeTasks.delete(task.id);
        this.processQueue();
    }
    async cleanupTaskFiles(task) {
        try {
            if ((0, fs_1.existsSync)(task.meta.tmpFilePath))
                await fs_2.promises.unlink(task.meta.tmpFilePath);
        }
        catch { }
        await deleteMeta(task.id);
    }
    sendProgress(task) {
        this.mainWindow.webContents.send('download-progress', task.progress);
    }
    processQueue() {
        while (this.activeTasks.size < this.maxConcurrentDownloads &&
            this.queuedTasks.length > 0) {
            const next = this.queuedTasks.shift();
            this.startNewTask(next.request, next.options);
        }
    }
    fileKey(r) {
        return `${r.path}/${r.fileName}`;
    }
    isActivelyDownloading(r) {
        const k = this.fileKey(r);
        for (const t of this.activeTasks.values()) {
            if (this.fileKey(t.request) === k)
                return true;
        }
        return false;
    }
    isSameFile(a, b) {
        return this.fileKey(a) === this.fileKey(b);
    }
    findNonPriorityTask() {
        for (const t of this.activeTasks.values()) {
            if (!t.request.priority)
                return t;
        }
        return undefined;
    }
    removeFromQueue(r) {
        this.queuedTasks = this.queuedTasks.filter(t => !this.isSameFile(t.request, r));
    }
}
exports.DownloadManager = DownloadManager;
// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
function avg(arr) {
    if (arr.length === 0)
        return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
