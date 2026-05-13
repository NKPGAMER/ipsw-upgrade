"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWWatcher = exports.IPSW_IPC = void 0;
const chokidar_1 = __importDefault(require("chokidar"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
/** IPC channels */
exports.IPSW_IPC = {
    /** main → renderer: IPSWFile[] (các file vừa thêm) hoặc [] (có file bị xoá) */
    RELOAD: "ipsw:reload",
    /** renderer → main: string (đường dẫn mới) */
    CHANGE_DIR: "ipsw:change-dir",
    /** renderer → main: string | string[] (path) */
    DELETE_FILE: "ipsw:delete-file",
    /** renderer → main (invoke): trả về IPSWFile[] */
    GET_FILES: "ipsw:get-files",
};
class IPSWWatcher {
    win;
    watchDir;
    files = new Map();
    watcher = null;
    addedCallbacks = new Set();
    removedCallbacks = new Set();
    activeReload = null;
    pendingDir = null;
    constructor(win, watchDir) {
        this.win = win;
        this.watchDir = path_1.default.resolve(watchDir);
        this.registerIpcHandlers();
    }
    normalizeDir(dir) {
        return path_1.default.resolve(dir).replace(/[\\/]+$/, "").toLowerCase();
    }
    async start() {
        await this.scanExisting();
        this.beginWatch();
        this.sendReload(this.getFiles());
    }
    async stop() {
        electron_1.ipcMain.removeHandler(exports.IPSW_IPC.GET_FILES);
        electron_1.ipcMain.removeHandler(exports.IPSW_IPC.DELETE_FILE);
        electron_1.ipcMain.removeHandler(exports.IPSW_IPC.CHANGE_DIR);
        this.addedCallbacks.clear();
        this.removedCallbacks.clear();
        await this.watcher?.close();
        this.watcher = null;
    }
    onFilesAdded(callback) {
        this.addedCallbacks.add(callback);
        return () => this.addedCallbacks.delete(callback);
    }
    onFilesRemoved(callback) {
        this.removedCallbacks.add(callback);
        return () => this.removedCallbacks.delete(callback);
    }
    getFiles() {
        return [...this.files.values()];
    }
    changeDir(newDir) {
        const nextDir = this.normalizeDir(newDir);
        const currentDir = this.normalizeDir(this.watchDir);
        const pendingDir = this.pendingDir ? this.normalizeDir(this.pendingDir) : null;
        if (nextDir === currentDir)
            return;
        if (pendingDir !== null && nextDir === pendingDir)
            return;
        if (this.activeReload !== null) {
            this.pendingDir = newDir;
            return;
        }
        this.activeReload = this.runReload(newDir).finally(() => {
            this.activeReload = null;
            if (this.pendingDir !== null) {
                const next = this.pendingDir;
                this.pendingDir = null;
                this.changeDir(next);
            }
        });
    }
    async deleteFile(target) {
        const targets = Array.isArray(target) ? target : [target];
        const paths = targets.map((t) => (typeof t === "string" ? t : t.path));
        await Promise.all(paths.map((p) => promises_1.default.unlink(p)));
    }
    registerIpcHandlers() {
        try {
            electron_1.ipcMain.removeHandler(exports.IPSW_IPC.GET_FILES);
        }
        catch { }
        try {
            electron_1.ipcMain.removeHandler(exports.IPSW_IPC.DELETE_FILE);
        }
        catch { }
        try {
            electron_1.ipcMain.removeHandler(exports.IPSW_IPC.CHANGE_DIR);
        }
        catch { }
        electron_1.ipcMain.handle(exports.IPSW_IPC.GET_FILES, () => this.getFiles());
        electron_1.ipcMain.handle(exports.IPSW_IPC.DELETE_FILE, (_event, target) => this.deleteFile(target));
        electron_1.ipcMain.handle(exports.IPSW_IPC.CHANGE_DIR, (_event, newDir) => {
            this.changeDir(newDir);
        });
    }
    async runReload(newDir) {
        console.log(`[IPSWWatcher] Reloading dir: ${newDir}`);
        await this.watcher?.close();
        this.watcher = null;
        this.watchDir = path_1.default.resolve(newDir);
        await this.scanExisting();
        this.beginWatch();
        this.sendReload(this.getFiles());
    }
    async scanExisting() {
        this.files = new Map();
        let entries;
        try {
            entries = await promises_1.default.readdir(this.watchDir);
        }
        catch (err) {
            console.error(`[IPSWWatcher] Failed to readdir ${this.watchDir}:`, err);
            return;
        }
        await Promise.all(entries
            .filter((e) => e.toLowerCase().endsWith(".ipsw"))
            .map(async (entry) => {
            const fullPath = path_1.default.join(this.watchDir, entry);
            const file = await this.buildIPSWFile(fullPath);
            if (file)
                this.files.set(fullPath, file);
        }));
    }
    beginWatch() {
        const watchDir = path_1.default.resolve(this.watchDir);
        const watchDirClean = watchDir.replace(/[\\/]+$/, "").toLowerCase();
        this.watcher = chokidar_1.default.watch(watchDir, {
            ignored: (filePath) => {
                const resolved = path_1.default.resolve(filePath);
                // Luôn watch chính watchDir
                if (resolved.replace(/[\\/]+$/, "").toLowerCase() === watchDirClean)
                    return false;
                // Chỉ giữ lại .ipsw, bỏ hết còn lại
                return !resolved.toLowerCase().endsWith(".ipsw");
            },
            persistent: true,
            ignoreInitial: true,
            depth: 0,
            followSymlinks: false,
            awaitWriteFinish: {
                stabilityThreshold: 3000,
                pollInterval: 500,
            },
        });
        this.watcher.on("add", (filePath) => void this.onAdded(filePath));
        this.watcher.on("unlink", (filePath) => void this.onRemoved(filePath));
        this.watcher.on("error", (err) => {
            if (err.code === "EPERM" || err.code === "EACCES") {
                console.warn(`[IPSWWatcher] Permission denied (skipped): ${err.path}`);
                return;
            }
            console.error("[IPSWWatcher] watcher error:", err);
        });
    }
    async onAdded(filePath) {
        const ready = await this.waitForStableFile(filePath);
        if (!ready)
            return;
        console.log(`[IPSWWatcher] File write finished: ${filePath}`);
        const file = await this.buildIPSWFile(filePath);
        if (!file)
            return;
        this.files.set(filePath, file);
        this.sendReload([file]);
        await Promise.all([...this.addedCallbacks].map((callback) => Promise.resolve(callback([file]))));
    }
    async onRemoved(filePath) {
        const file = this.files.get(filePath);
        if (!file)
            return;
        try {
            await promises_1.default.access(filePath);
            // File still exists — chokidar emitted a spurious unlink (common on Windows root dirs)
            return;
        }
        catch {
            // File is truly gone
        }
        this.files.delete(filePath);
        this.sendReload([]);
        await Promise.all([...this.removedCallbacks].map((callback) => Promise.resolve(callback([file]))));
    }
    sendReload(files) {
        if (this.win.isDestroyed())
            return;
        this.win.webContents.send(exports.IPSW_IPC.RELOAD, files);
    }
    async buildIPSWFile(filePath) {
        try {
            const stat = await promises_1.default.stat(filePath);
            const r = {
                name: path_1.default.basename(filePath),
                path: filePath,
                size: stat.size,
            };
            return r;
        }
        catch {
            return null;
        }
    }
    async waitForStableFile(filePath) {
        const timeoutMs = 15_000;
        const stableChecksRequired = 3;
        const pollIntervalMs = 1000;
        let lastSize = -1;
        let stableChecks = 0;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            try {
                const stat = await promises_1.default.stat(filePath);
                if (!stat.isFile())
                    return false;
                if (stat.size > 0 && stat.size === lastSize) {
                    stableChecks += 1;
                    if (stableChecks >= stableChecksRequired)
                        return true;
                }
                else {
                    stableChecks = 0;
                    lastSize = stat.size;
                }
            }
            catch {
                return false;
            }
            await this.sleep(pollIntervalMs);
        }
        return false;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.IPSWWatcher = IPSWWatcher;
