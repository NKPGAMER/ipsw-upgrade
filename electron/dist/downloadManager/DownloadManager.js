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
exports.DownloadManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const dns = __importStar(require("dns"));
const events_1 = require("events");
const uuid_1 = require("uuid");
const httpClient_1 = require("./httpClient");
const driveDetect_1 = require("./driveDetect");
const merger_1 = require("./merger");
const STATE_FILE = path.join(os.tmpdir(), "dm_state.json");
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_PARTS = 16;
const SPEED_WINDOW_MS = 3000;
class DownloadManager extends events_1.EventEmitter {
    tasks = new Map();
    queue = [];
    active = new Set();
    maxConcurrent;
    maxParts;
    tempBaseDir;
    cancelFlags = new Map();
    pauseFlags = new Map();
    // ── AbortController map: taskId → Set of active AC for all parts ────────────
    // Khi pause/cancel gọi ac.abort() ngay → reader.read() throw AbortError tức thì
    abortControllers = new Map();
    speedBuffers = new Map();
    networkOnline = true;
    networkCheckInterval;
    constructor(opts = {}) {
        super();
        this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this.maxParts = opts.maxParts ?? DEFAULT_MAX_PARTS;
        this.tempBaseDir = opts.tempBaseDir ?? os.tmpdir();
        this._startNetworkMonitor();
        this._loadState();
    }
    // ─── Public API ────────────────────────────────────────────────────────────────
    add(url, destPath, priority = 0) {
        const id = (0, uuid_1.v4)();
        const { tempDir } = (0, driveDetect_1.resolveTempDir)(destPath, id, this.tempBaseDir);
        const task = {
            id, url, destPath, tempDir,
            fileSize: 0, supportsRange: false,
            parts: [], state: "wait",
            speed: 0, eta: 0, totalDownloaded: 0,
            createdAt: Date.now(), priority,
        };
        this.tasks.set(id, task);
        this.cancelFlags.set(id, false);
        this.pauseFlags.set(id, false);
        this.speedBuffers.set(id, []);
        this.abortControllers.set(id, new Set());
        this.queue.push(id);
        this._sortQueue();
        this._emit(id, "state");
        this._tick();
        return id;
    }
    pause(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        if (task.state !== "downloading")
            return;
        this.pauseFlags.set(id, true);
        task.state = "paused";
        task.speed = 0;
        // ── Abort tất cả streams đang chạy của task này NGAY LẬP TỨC ──────────────
        this._abortAll(id);
        this._emit(id, "state");
    }
    resume(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        if (task.state !== "paused" && task.state !== "error")
            return;
        this.pauseFlags.set(id, false);
        this.cancelFlags.set(id, false);
        if (this.active.size < this.maxConcurrent) {
            this._startTask(id);
        }
        else {
            task.state = "wait";
            if (!this.queue.includes(id))
                this.queue.unshift(id);
            this._emit(id, "state");
        }
    }
    cancel(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        this.cancelFlags.set(id, true);
        task.state = "cancel";
        task.speed = 0;
        // ── Abort tất cả streams ngay ─────────────────────────────────────────────
        this._abortAll(id);
        this.active.delete(id);
        const qi = this.queue.indexOf(id);
        if (qi !== -1)
            this.queue.splice(qi, 1);
        setImmediate(() => this._cleanTemp(task));
        this._emit(id, "state");
        this._tick();
    }
    pauseAll() {
        for (const [id, task] of this.tasks) {
            if (task.state === "downloading")
                this.pause(id);
        }
    }
    resumeAll() {
        for (const [id, task] of this.tasks) {
            if (task.state === "paused")
                this.resume(id);
        }
    }
    getAll() {
        return Array.from(this.tasks.values());
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    updateQueue(orderedIds) {
        this.queue = orderedIds.filter((id) => this.queue.includes(id));
        this._tick();
    }
    async onExit() {
        // Pause tất cả đang tải
        for (const id of this.active) {
            this.pauseFlags.set(id, true);
            this._abortAll(id);
        }
        await new Promise((r) => setTimeout(r, 800));
        this._saveState();
        if (this.networkCheckInterval)
            clearInterval(this.networkCheckInterval);
    }
    // ─── AbortController helpers ──────────────────────────────────────────────────
    /** Register một AbortController mới cho task (gọi từ httpClient callback) */
    _registerAC(taskId, ac) {
        const set = this.abortControllers.get(taskId);
        if (set)
            set.add(ac);
    }
    /** Abort tất cả AC của task và clear set */
    _abortAll(taskId) {
        const set = this.abortControllers.get(taskId);
        if (!set)
            return;
        for (const ac of set) {
            try {
                ac.abort();
            }
            catch { }
        }
        set.clear();
    }
    // ─── Internal ─────────────────────────────────────────────────────────────────
    _tick() {
        while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
            const id = this.queue.shift();
            const task = this.tasks.get(id);
            if (!task || task.state === "cancel")
                continue;
            this._startTask(id);
        }
    }
    async _startTask(id) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        this.active.add(id);
        this.pauseFlags.set(id, false);
        this.cancelFlags.set(id, false);
        this.abortControllers.set(id, new Set()); // fresh set per run
        task.state = "downloading";
        this._emit(id, "state");
        try {
            if (task.fileSize === 0) {
                const info = await (0, httpClient_1.checkRangeSupport)(task.url);
                task.fileSize = info.fileSize;
                task.supportsRange = info.supportsRange;
                this._emit(id, "state");
            }
            // Check if paused/cancelled during range check
            if (this.cancelFlags.get(id))
                return;
            if (this.pauseFlags.get(id)) {
                task.state = "paused";
                this._emit(id, "state");
                return;
            }
            fs.mkdirSync(task.tempDir, { recursive: true });
            if (task.supportsRange && task.fileSize > 0) {
                await this._downloadWithParts(task);
            }
            else {
                await this._downloadSingle(task);
            }
            const stateNow = task.state;
            if (this.cancelFlags.get(id) || stateNow === "cancel")
                return;
            if (this.pauseFlags.get(id) || stateNow === "paused") {
                task.state = "paused";
                this._emit(id, "state");
                return;
            }
            if (task.supportsRange && task.parts.length > 1) {
                task.state = "merging";
                this._emit(id, "state");
                await this._merge(task);
            }
            else {
                task.state = "done";
                this._emit(id, "done");
            }
        }
        catch (err) {
            const stateNow = task.state;
            if (stateNow !== "cancel" && stateNow !== "paused") {
                task.state = "error";
                task.error = err.message;
                this._emit(id, "error");
            }
        }
        finally {
            this.active.delete(id);
            this._tick();
        }
    }
    async _downloadWithParts(task) {
        const { id, fileSize, tempDir } = task;
        if (task.parts.length === 0) {
            const numParts = Math.min(this.maxParts, Math.max(1, Math.floor(fileSize / (1024 * 1024))));
            task.parts = (0, httpClient_1.buildParts)(fileSize, numParts, tempDir);
        }
        for (const part of task.parts) {
            if (!part.done) {
                const existing = (0, httpClient_1.getExistingBytes)(part.tempFile);
                const partSize = part.endBytes - part.startBytes + 1;
                part.downloaded = existing;
                part.progress = existing ? Math.min(100, Math.round((existing / partSize) * 100)) : 0;
                if (existing >= partSize) {
                    part.done = true;
                    part.progress = 100;
                    part.downloaded = partSize;
                }
            }
        }
        task.totalDownloaded = task.parts.reduce((s, p) => s + p.downloaded, 0);
        this._emit(id, "progress");
        const pendingParts = task.parts.filter((p) => !p.done);
        if (pendingParts.length === 0)
            return;
        await this._runPartsWithConcurrency(task, pendingParts, pendingParts.length);
    }
    _runPartsWithConcurrency(task, parts, concurrency) {
        const { id, url } = task;
        const queue = [...parts];
        let active = 0;
        let settled = false;
        let rejected = [];
        return new Promise((resolve) => {
            const finish = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const tryNext = () => {
                if (this.cancelFlags.get(id) || task.state === "cancel") {
                    if (active === 0)
                        finish();
                    return;
                }
                if (this.pauseFlags.get(id)) {
                    if (active === 0)
                        finish();
                    return;
                }
                if (queue.length === 0 && active === 0) {
                    if (rejected.length > 0) {
                        queue.push(...rejected);
                        rejected = [];
                        tryNext();
                    }
                    else {
                        finish();
                    }
                    return;
                }
                while (active < concurrency && queue.length > 0) {
                    const part = queue.shift();
                    active++;
                    (0, httpClient_1.downloadPart)(url, part, {
                        onAbortController: (ac) => this._registerAC(id, ac),
                        onProgress: (_p, bytes) => {
                            task.totalDownloaded += bytes;
                            this._recordSpeed(id, bytes);
                            this._updateSpeedETA(task);
                            this._emit(id, "progress");
                        },
                        onDone: (_p) => {
                            active--;
                            this._emit(id, "part-update");
                            tryNext();
                        },
                        onError: (_p, _err) => {
                            active--;
                            rejected.push(part);
                            setTimeout(tryNext, 3000);
                        },
                        isCancelled: () => !!this.cancelFlags.get(id),
                        isPaused: () => !!this.pauseFlags.get(id),
                    }).catch(() => {
                        active--;
                        tryNext();
                    });
                }
            };
            tryNext();
        });
    }
    async _downloadSingle(task) {
        const { id, url, destPath } = task;
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        await (0, httpClient_1.downloadSingleStream)(url, destPath, {
            onAbortController: (ac) => this._registerAC(id, ac),
            onProgress: (downloaded, total) => {
                task.totalDownloaded = downloaded;
                task.fileSize = total;
                task.parts = [{
                        index: 0,
                        startBytes: 0,
                        endBytes: total - 1,
                        progress: total ? Math.round((downloaded / total) * 100) : 0,
                        downloaded,
                        tempFile: destPath,
                        done: false,
                    }];
                this._recordSpeed(id, downloaded - (task.totalDownloaded || 0));
                this._updateSpeedETA(task);
                this._emit(id, "progress");
            },
            onDone: () => { },
            onError: (err) => { throw err; },
            isCancelled: () => !!this.cancelFlags.get(id),
            isPaused: () => !!this.pauseFlags.get(id),
        });
    }
    async _merge(task) {
        const { tempDir, destPath } = task;
        const { isHDDDest } = (0, driveDetect_1.resolveTempDir)(destPath, task.id, this.tempBaseDir);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        await (0, merger_1.mergeParts)({
            parts: task.parts,
            destPath,
            isHDDDest,
            tempDir,
            onProgress: (pct, written, total) => {
                this.emit("event", {
                    id: task.id,
                    type: "merge-progress",
                    payload: { ...task, mergeProgress: pct },
                });
            },
            onDone: () => {
                task.state = "done";
                this._emit(task.id, "done");
            },
            onError: (err) => {
                task.state = "error";
                task.error = err.message;
                this._emit(task.id, "error");
            },
        });
    }
    // ─── Speed / ETA ──────────────────────────────────────────────────────────────
    _recordSpeed(id, bytes) {
        const buf = this.speedBuffers.get(id) ?? [];
        const now = Date.now();
        buf.push({ time: now, bytes });
        const cutoff = now - SPEED_WINDOW_MS;
        this.speedBuffers.set(id, buf.filter((e) => e.time >= cutoff));
    }
    _updateSpeedETA(task) {
        const buf = this.speedBuffers.get(task.id) ?? [];
        if (buf.length < 2)
            return;
        const oldest = buf[0];
        const newest = buf[buf.length - 1];
        const dt = (newest.time - oldest.time) / 1000;
        const db = buf.slice(1).reduce((s, e) => s + e.bytes, 0);
        task.speed = dt > 0 ? Math.round(db / dt) : 0;
        const remaining = task.fileSize - task.totalDownloaded;
        task.eta = task.speed > 0 ? Math.round(remaining / task.speed) : 0;
    }
    // ─── Event ────────────────────────────────────────────────────────────────────
    _emit(id, type) {
        const task = this.tasks.get(id);
        if (!task)
            return;
        this.emit("event", { id, type, payload: { ...task } });
    }
    // ─── Network monitor ──────────────────────────────────────────────────────────
    /**
     * Dùng dns.lookup thay vì HTTP fetch để detect mất mạng.
     *
     * Lý do: undici giữ connection pool — socket cũ vẫn còn sống và tiếp tục nhận
     * buffer TCP sau khi WiFi bị tắt. HTTP ping đến Google qua socket cũ sẽ vẫn
     * thành công trong vài giây.
     *
     * dns.lookup dùng OS resolver — OS biết ngay khi interface mạng down.
     * Nếu lookup fail trong 1s → offline chắc chắn.
     */
    _startNetworkMonitor() {
        const check = () => {
            dns.lookup("1.1.1.1", { family: 4 }, (err) => {
                const online = !err;
                if (!online && this.networkOnline) {
                    this.networkOnline = false;
                    // Pause tất cả đang tải — abort ngay lập tức
                    for (const id of Array.from(this.active)) {
                        const task = this.tasks.get(id);
                        if (task && task.state === "downloading") {
                            this.pauseFlags.set(id, true);
                            task.state = "paused";
                            task.speed = 0;
                            this._abortAll(id);
                            this._emit(id, "state");
                        }
                    }
                    this.emit("network-offline");
                }
                else if (online && !this.networkOnline) {
                    this.networkOnline = true;
                    this.emit("network-online");
                    // Auto-resume
                    for (const [id, task] of this.tasks) {
                        if (task.state === "paused")
                            this.resume(id);
                    }
                }
            });
        };
        // Check ngay lập tức lần đầu, rồi mỗi 2 giây
        check();
        this.networkCheckInterval = setInterval(check, 2000);
    }
    // ─── Queue sort ───────────────────────────────────────────────────────────────
    _sortQueue() {
        this.queue.sort((a, b) => {
            const ta = this.tasks.get(a);
            const tb = this.tasks.get(b);
            if (!ta || !tb)
                return 0;
            return ta.priority - tb.priority || ta.createdAt - tb.createdAt;
        });
    }
    // ─── Cleanup ──────────────────────────────────────────────────────────────────
    _cleanTemp(task) {
        try {
            fs.rmSync(task.tempDir, { recursive: true, force: true });
        }
        catch { }
    }
    // ─── State persistence ────────────────────────────────────────────────────────
    _saveState() {
        try {
            const state = [];
            for (const [, task] of this.tasks) {
                if (task.state === "downloading" || task.state === "paused" || task.state === "wait") {
                    state.push({ ...task, state: "paused" });
                }
            }
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
        }
        catch (e) {
            console.error("[DM] Failed to save state:", e);
        }
    }
    _loadState() {
        try {
            if (!fs.existsSync(STATE_FILE))
                return;
            const tasks = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            for (const task of tasks) {
                this.tasks.set(task.id, task);
                this.cancelFlags.set(task.id, false);
                this.pauseFlags.set(task.id, true);
                this.speedBuffers.set(task.id, []);
                this.abortControllers.set(task.id, new Set());
            }
        }
        catch (e) {
            console.error("[DM] Failed to load state:", e);
        }
    }
}
exports.DownloadManager = DownloadManager;
