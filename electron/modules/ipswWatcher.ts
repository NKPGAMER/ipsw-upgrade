import chokidar, { FSWatcher } from "chokidar";
import fs from "fs/promises";
import { Stats } from "fs";
import path from "path";
import { BrowserWindow, ipcMain } from "electron";

export interface IPSWFile {
  name: string;
  path: string;
  size: number;
}

/** IPC channels */
export const IPSW_IPC = {
  /** main → renderer: IPSWFile[] (các file vừa thêm) hoặc [] (có file bị xoá) */
  RELOAD: "ipsw:reload",
  /** renderer → main: string (đường dẫn mới) */
  CHANGE_DIR: "ipsw:change-dir",
  /** renderer → main: string | string[] (path) */
  DELETE_FILE: "ipsw:delete-file",
  /** renderer → main (invoke): trả về IPSWFile[] */
  GET_FILES: "ipsw:get-files",
} as const;

type IPSWWatcherCallback = (files: IPSWFile[]) => void | Promise<void>;

export class IPSWWatcher {
  private readonly win: BrowserWindow;
  private watchDir: string;
  private files: Map<string, IPSWFile> = new Map();
  private watcher: FSWatcher | null = null;
  private addedCallbacks = new Set<IPSWWatcherCallback>();
  private removedCallbacks = new Set<IPSWWatcherCallback>();

  private activeReload: Promise<void> | null = null;
  private pendingDir: string | null = null;

  constructor(win: BrowserWindow, watchDir: string) {
    this.win = win;
    this.watchDir = path.resolve(watchDir);
    this.registerIpcHandlers();
  }

  private normalizeDir(dir: string): string {
    return path.resolve(dir).replace(/[\\/]+$/, "").toLowerCase();
  }

  async start(): Promise<void> {
    await this.scanExisting();
    this.beginWatch();
    this.sendReload(this.getFiles());
  }

  async stop(): Promise<void> {
    ipcMain.removeHandler(IPSW_IPC.GET_FILES);
    ipcMain.removeHandler(IPSW_IPC.DELETE_FILE);
    ipcMain.removeHandler(IPSW_IPC.CHANGE_DIR);
    this.addedCallbacks.clear();
    this.removedCallbacks.clear();
    await this.watcher?.close();
    this.watcher = null;
  }

  onFilesAdded(callback: IPSWWatcherCallback): () => void {
    this.addedCallbacks.add(callback);
    return () => this.addedCallbacks.delete(callback);
  }

  onFilesRemoved(callback: IPSWWatcherCallback): () => void {
    this.removedCallbacks.add(callback);
    return () => this.removedCallbacks.delete(callback);
  }

  getFiles(): IPSWFile[] {
    return [...this.files.values()];
  }

  changeDir(newDir: string): void {
    const nextDir = this.normalizeDir(newDir);
    const currentDir = this.normalizeDir(this.watchDir);
    const pendingDir = this.pendingDir ? this.normalizeDir(this.pendingDir) : null;

    if (nextDir === currentDir) return;
    if (pendingDir !== null && nextDir === pendingDir) return;

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

  async deleteFile(target: string | string[] | IPSWFile | IPSWFile[]): Promise<void> {
    const targets = Array.isArray(target) ? target : [target];
    const paths = targets.map((t) => (typeof t === "string" ? t : t.path));
    await Promise.all(paths.map((p) => fs.unlink(p)));
  }

  private registerIpcHandlers(): void {
    try { ipcMain.removeHandler(IPSW_IPC.GET_FILES); } catch {}
    try { ipcMain.removeHandler(IPSW_IPC.DELETE_FILE); } catch {}
    try { ipcMain.removeHandler(IPSW_IPC.CHANGE_DIR); } catch {}

    ipcMain.handle(IPSW_IPC.GET_FILES, () => this.getFiles());

    ipcMain.handle(IPSW_IPC.DELETE_FILE, (_event, target: string | string[]) =>
      this.deleteFile(target)
    );

    ipcMain.handle(IPSW_IPC.CHANGE_DIR, (_event, newDir: string) => {
      this.changeDir(newDir);
    });
  }

  private async runReload(newDir: string): Promise<void> {
    console.log(`[IPSWWatcher] Reloading dir: ${newDir}`);

    await this.watcher?.close();
    this.watcher = null;
    this.watchDir = path.resolve(newDir);

    await this.scanExisting();
    this.beginWatch();
    this.sendReload(this.getFiles());
  }

  private async scanExisting(): Promise<void> {
    this.files = new Map();

    let entries: string[];
    try {
      entries = await fs.readdir(this.watchDir);
    } catch (err) {
      console.error(`[IPSWWatcher] Failed to readdir ${this.watchDir}:`, err);
      return;
    }

    await Promise.all(
      entries
        .filter((e) => e.toLowerCase().endsWith(".ipsw"))
        .map(async (entry) => {
          const fullPath = path.join(this.watchDir, entry);
          const file = await this.buildIPSWFile(fullPath);
          if (file) this.files.set(fullPath, file);
        })
    );
  }

  private beginWatch(): void {
    const watchDir = path.resolve(this.watchDir);
    const watchDirClean = watchDir.replace(/[\\/]+$/, "").toLowerCase();

    this.watcher = chokidar.watch(watchDir, {
      ignored: (filePath: string) => {
        const resolved = path.resolve(filePath);

        // Luôn watch chính watchDir
        if (resolved.replace(/[\\/]+$/, "").toLowerCase() === watchDirClean) return false;
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
    this.watcher.on("error", (err: any) => {
      if (err.code === "EPERM" || err.code === "EACCES") {
        console.warn(`[IPSWWatcher] Permission denied (skipped): ${err.path}`);
        return;
      }
      console.error("[IPSWWatcher] watcher error:", err);
    });
  }

  private async onAdded(filePath: string): Promise<void> {
    const ready = await this.waitForStableFile(filePath);
    if (!ready) return;

    console.log(`[IPSWWatcher] File write finished: ${filePath}`);

    const file = await this.buildIPSWFile(filePath);
    if (!file) return;

    this.files.set(filePath, file);
    this.sendReload([file]);
    await Promise.all([...this.addedCallbacks].map((callback) => Promise.resolve(callback([file]))));
  }

  private async onRemoved(filePath: string): Promise<void> {
    const file = this.files.get(filePath);
    if (!file) return;

    try {
      await fs.access(filePath);
      // File still exists — chokidar emitted a spurious unlink (common on Windows root dirs)
      return;
    } catch {
      // File is truly gone
    }

    this.files.delete(filePath);
    this.sendReload([]);
    await Promise.all([...this.removedCallbacks].map((callback) => Promise.resolve(callback([file]))));
  }

  private sendReload(files: IPSWFile[]): void {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send(IPSW_IPC.RELOAD, files);
  }

  private async buildIPSWFile(filePath: string): Promise<IPSWFile | null> {
    try {
      const stat = await fs.stat(filePath);
      const r = {
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
      };

      return r;
    } catch {
      return null;
    }
  }

  private async waitForStableFile(filePath: string): Promise<boolean> {
    const timeoutMs = 15_000;
    const stableChecksRequired = 3;
    const pollIntervalMs = 1000;

    let lastSize = -1;
    let stableChecks = 0;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) return false;

        if (stat.size > 0 && stat.size === lastSize) {
          stableChecks += 1;
          if (stableChecks >= stableChecksRequired) return true;
        } else {
          stableChecks = 0;
          lastSize = stat.size;
        }
      } catch {
        return false;
      }

      await this.sleep(pollIntervalMs);
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
