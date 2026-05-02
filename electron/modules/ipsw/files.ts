import fs from "fs/promises";
import fe from "fs-extra";
import path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { DataHandle } from "../dataHandle";
import { BrowserWindow } from "electron";

interface FileInfo {
    name: string;
    path: string;
    size: number;
}

export class IpswFiles {
    private readonly win: BrowserWindow;
    private readonly dh: DataHandle;
    private ipswFiles: FileInfo[] = [];
    private turboFiles: FileInfo[] = [];
    private tmpFiles: FileInfo[] = [];
    private saveDir: string;
    private tmpDir: string;
    private watcher: FSWatcher | null = null;

    constructor(win: BrowserWindow, dh: DataHandle, saveDir: string, tmpDir: string) {
        this.win = win;
        this.dh = dh;
        this.saveDir = saveDir;
        this.tmpDir = tmpDir;
    }

    // ─── Public Getters ────────────────────────────────────────────────────────

    getIpswFiles(): FileInfo[] {
        return [...this.ipswFiles];
    }

    getTurboFiles(): FileInfo[] {
        return [...this.turboFiles];
    }

    getTmpFiles(): FileInfo[] {
        return [...this.tmpFiles];
    }

    getFiles(options: {
        device?: Device;
        identifier?: Device['identifier'];
    }) {
        const device = options.device || this.dh.getDevices().filter(d => d.identifier === options.identifier);
        if (!device) return [];

        const files = this.getIpswFiles()
    }

    // ─── Watcher ───────────────────────────────────────────────────────────────

    async startWatcher(): Promise<void> {
        if (this.watcher) return;

        await fe.ensureDir(this.saveDir);
        await fe.ensureDir(this.tmpDir);

        // Initial scan
        await this.scanAll();

        this.watcher = chokidar.watch([this.saveDir, this.tmpDir], {
            ignoreInitial: true,        // We already scanned above
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        });

        this.watcher
            .on("add",    (filePath) => this.handleAdd(filePath))
            .on("unlink", (filePath) => this.handleRemove(filePath))
            .on("change", (filePath) => this.handleChange(filePath))
            .on("error",  (error)    => console.error("[IpswFiles] Watcher error:", error));
    }

    async stopWatcher(): Promise<void> {
        if (!this.watcher) return;
        await this.watcher.close();
        this.watcher = null;
    }

    // ─── Scan ──────────────────────────────────────────────────────────────────

    private async scanAll(): Promise<void> {
        const [saveEntries, tmpEntries] = await Promise.all([
            this.readDirSafe(this.saveDir),
            this.readDirSafe(this.tmpDir),
        ]);

        const savePaths = saveEntries.map((e) => path.join(this.saveDir, e));
        const tmpPaths  = tmpEntries .map((e) => path.join(this.tmpDir,  e));

        const [saveInfos, tmpInfos] = await Promise.all([
            Promise.all(savePaths.map((p) => this.buildFileInfo(p))),
            Promise.all(tmpPaths .map((p) => this.buildFileInfo(p))),
        ]);

        const validSave = saveInfos.filter((f): f is FileInfo => f !== null);
        const validTmp  = tmpInfos .filter((f): f is FileInfo => f !== null);

        this.ipswFiles  = validSave.filter((f) => f.name.endsWith(".ipsw"));
        this.turboFiles = validSave.filter((f) => f.name.endsWith(".ipsw.turbo"));
        this.tmpFiles   = validTmp .filter((f) => f.name.endsWith(".ipsw.tmp"));
    }

    // ─── Watcher Handlers ──────────────────────────────────────────────────────

    private async handleAdd(filePath: string): Promise<void> {
        const info = await this.buildFileInfo(filePath);
        if (!info) return;

        const list = this.resolveList(filePath, info.name);
        if (!list) return;

        // Avoid duplicates (e.g. rapid events)
        if (!list.find((f) => f.path === filePath)) {
            list.push(info);
        }
    }

    private handleRemove(filePath: string): void {
        this.ipswFiles  = this.ipswFiles .filter((f) => f.path !== filePath);
        this.turboFiles = this.turboFiles.filter((f) => f.path !== filePath);
        this.tmpFiles   = this.tmpFiles  .filter((f) => f.path !== filePath);
    }

    private async handleChange(filePath: string): Promise<void> {
        // Re-read size after a change (e.g. partial write completed)
        const info = await this.buildFileInfo(filePath);
        if (!info) return;

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
    private resolveList(filePath: string, name: string): FileInfo[] | null {
        const inSave = filePath.startsWith(this.saveDir);
        const inTmp  = filePath.startsWith(this.tmpDir);

        if (inSave && name.endsWith(".ipsw.turbo")) return this.turboFiles;
        if (inSave && name.endsWith(".ipsw"))       return this.ipswFiles;
        if (inTmp  && name.endsWith(".ipsw.tmp"))   return this.tmpFiles;

        return null;
    }

    private async buildFileInfo(filePath: string): Promise<FileInfo | null> {
        try {
            const stat = await fs.stat(filePath);
            return {
                name: path.basename(filePath),
                path: filePath,
                size: stat.size,
            };
        } catch {
            return null;
        }
    }

    private async readDirSafe(dir: string): Promise<string[]> {
        try {
            return await fs.readdir(dir);
        } catch {
            return [];
        }
    }
}