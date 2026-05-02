"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpswFiles = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const chokidar_1 = __importDefault(require("chokidar"));
class IpswFiles {
    win;
    dh;
    ipswFiles = [];
    turboFiles = [];
    tmpFiles = [];
    saveDir;
    tmpDir;
    watcher = null;
    constructor(win, dh, saveDir, tmpDir) {
        this.win = win;
        this.dh = dh;
        this.saveDir = saveDir;
        this.tmpDir = tmpDir;
    }
    // ─── Public Getters ────────────────────────────────────────────────────────
    getIpswFiles() {
        return [...this.ipswFiles];
    }
    getTurboFiles() {
        return [...this.turboFiles];
    }
    getTmpFiles() {
        return [...this.tmpFiles];
    }
    getFiles(options) {
        const device = options.device || this.dh.getDevices().filter(d => d.identifier === options.identifier);
        if (!device)
            return [];
        const files = this.getIpswFiles();
    }
    // ─── Watcher ───────────────────────────────────────────────────────────────
    async startWatcher() {
        if (this.watcher)
            return;
        await fs_extra_1.default.ensureDir(this.saveDir);
        await fs_extra_1.default.ensureDir(this.tmpDir);
        // Initial scan
        await this.scanAll();
        this.watcher = chokidar_1.default.watch([this.saveDir, this.tmpDir], {
            ignoreInitial: true, // We already scanned above
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        });
        this.watcher
            .on("add", (filePath) => this.handleAdd(filePath))
            .on("unlink", (filePath) => this.handleRemove(filePath))
            .on("change", (filePath) => this.handleChange(filePath))
            .on("error", (error) => console.error("[IpswFiles] Watcher error:", error));
    }
    async stopWatcher() {
        if (!this.watcher)
            return;
        await this.watcher.close();
        this.watcher = null;
    }
    // ─── Scan ──────────────────────────────────────────────────────────────────
    async scanAll() {
        const [saveEntries, tmpEntries] = await Promise.all([
            this.readDirSafe(this.saveDir),
            this.readDirSafe(this.tmpDir),
        ]);
        const savePaths = saveEntries.map((e) => path_1.default.join(this.saveDir, e));
        const tmpPaths = tmpEntries.map((e) => path_1.default.join(this.tmpDir, e));
        const [saveInfos, tmpInfos] = await Promise.all([
            Promise.all(savePaths.map((p) => this.buildFileInfo(p))),
            Promise.all(tmpPaths.map((p) => this.buildFileInfo(p))),
        ]);
        const validSave = saveInfos.filter((f) => f !== null);
        const validTmp = tmpInfos.filter((f) => f !== null);
        this.ipswFiles = validSave.filter((f) => f.name.endsWith(".ipsw"));
        this.turboFiles = validSave.filter((f) => f.name.endsWith(".ipsw.turbo"));
        this.tmpFiles = validTmp.filter((f) => f.name.endsWith(".ipsw.tmp"));
    }
    // ─── Watcher Handlers ──────────────────────────────────────────────────────
    async handleAdd(filePath) {
        const info = await this.buildFileInfo(filePath);
        if (!info)
            return;
        const list = this.resolveList(filePath, info.name);
        if (!list)
            return;
        // Avoid duplicates (e.g. rapid events)
        if (!list.find((f) => f.path === filePath)) {
            list.push(info);
        }
    }
    handleRemove(filePath) {
        this.ipswFiles = this.ipswFiles.filter((f) => f.path !== filePath);
        this.turboFiles = this.turboFiles.filter((f) => f.path !== filePath);
        this.tmpFiles = this.tmpFiles.filter((f) => f.path !== filePath);
    }
    async handleChange(filePath) {
        // Re-read size after a change (e.g. partial write completed)
        const info = await this.buildFileInfo(filePath);
        if (!info)
            return;
        for (const list of [this.ipswFiles, this.turboFiles, this.tmpFiles]) {
            const idx = list.findIndex((f) => f.path === filePath);
            if (idx !== -1) {
                list[idx] = info;
                return;
            }
        }
        // Not tracked yet — treat as a new add
        await this.handleAdd(filePath);
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    /**
     * Returns the correct list for a file based on its location and extension,
     * or null if it doesn't match any tracked category.
     */
    resolveList(filePath, name) {
        const inSave = filePath.startsWith(this.saveDir);
        const inTmp = filePath.startsWith(this.tmpDir);
        if (inSave && name.endsWith(".ipsw.turbo"))
            return this.turboFiles;
        if (inSave && name.endsWith(".ipsw"))
            return this.ipswFiles;
        if (inTmp && name.endsWith(".ipsw.tmp"))
            return this.tmpFiles;
        return null;
    }
    async buildFileInfo(filePath) {
        try {
            const stat = await promises_1.default.stat(filePath);
            return {
                name: path_1.default.basename(filePath),
                path: filePath,
                size: stat.size,
            };
        }
        catch {
            return null;
        }
    }
    async readDirSafe(dir) {
        try {
            return await promises_1.default.readdir(dir);
        }
        catch {
            return [];
        }
    }
}
exports.IpswFiles = IpswFiles;
