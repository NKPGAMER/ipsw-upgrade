import chokidar, { FSWatcher } from "chokidar";
import fs from "fs/promises";
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

export class IPSWWatcher {
  private readonly win: BrowserWindow;
  private watchDir: string;
  private files: Map<string, IPSWFile> = new Map();
  private watcher: FSWatcher | null = null;

  // ── Task-aware debounce state ──────────────────────────────────────────────
  /** Promise của lần reload đang chạy. null = rảnh. */
  private activeReload: Promise<void> | null = null;
  /** Đường dẫn của request đang chờ (luôn giữ cái cuối nhất). */
  private pendingDir: string | null = null;

  constructor(win: BrowserWindow, watchDir: string) {
    this.win = win;
    this.watchDir = watchDir;
    this.registerIpcHandlers();
  }

  private normalizeDir(dir: string): string {
    return path.resolve(dir).replace(/[\\\/]+$/, "").toLowerCase();
  }

  // ─────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────

  /** Khởi tạo: scan tất cả .ipsw hiện có rồi bắt đầu watch. */
  async start(): Promise<void> {
    await this.scanExisting();
    this.beginWatch();
  }

  /** Dừng watcher, giải phóng tài nguyên và gỡ IPC handlers. */
  async stop(): Promise<void> {
    ipcMain.removeHandler(IPSW_IPC.GET_FILES);
    ipcMain.removeHandler(IPSW_IPC.DELETE_FILE);
    ipcMain.removeHandler(IPSW_IPC.CHANGE_DIR);
    await this.watcher?.close();
    this.watcher = null;
  }

  /** Trả về tất cả IPSWFile đang theo dõi. */
  getFiles(): IPSWFile[] {
    return [...this.files.values()];
  }

  /**
   * Đổi thư mục theo dõi.
   *
   * Chiến lược debounce: nếu đang có task reload chạy, lưu dir mới vào
   * `pendingDir` (ghi đè liên tục). Khi task hiện tại xong sẽ tự nhảy sang
   * task mới nhất — bỏ qua mọi request ở giữa.
   */
  changeDir(newDir: string): void {
    const nextDir = this.normalizeDir(newDir);
    const currentDir = this.normalizeDir(this.watchDir);
    const pendingDir = this.pendingDir ? this.normalizeDir(this.pendingDir) : null;

    if (nextDir === currentDir) return;
    if (pendingDir !== null && nextDir === pendingDir) return;

    if (this.activeReload !== null) {
      // Có task đang chạy → ghi đè pending, không tạo thêm task
      this.pendingDir = newDir;
      return;
    }

    // Không có task nào đang chạy → chạy ngay
    this.activeReload = this.runReload(newDir).finally(() => {
      this.activeReload = null;
      // Nếu trong lúc chạy có request mới → chạy tiếp với dir cuối nhất
      if (this.pendingDir !== null) {
        const next = this.pendingDir;
        this.pendingDir = null;
        this.changeDir(next);
      }
    });
  }

  /**
   * Xoá một hoặc nhiều tệp theo path (string) hoặc IPSWFile.
   * Hỗ trợ mọi dạng: string | string[] | IPSWFile | IPSWFile[]
   */
  async deleteFile(
    target: string | string[] | IPSWFile | IPSWFile[]
  ): Promise<void> {
    const targets = Array.isArray(target) ? target : [target];
    const paths = targets.map((t) => (typeof t === "string" ? t : t.path));

    await Promise.all(paths.map((p) => fs.unlink(p)));
  }

  // ─────────────────────────────────────────
  // IPC handlers (renderer ↔ main)
  // ─────────────────────────────────────────

  private registerIpcHandlers(): void {
    ipcMain.handle(IPSW_IPC.GET_FILES, () => this.getFiles());

    ipcMain.handle(IPSW_IPC.DELETE_FILE, (_event, target: string | string[]) =>
      this.deleteFile(target)
    );

    ipcMain.handle(IPSW_IPC.CHANGE_DIR, (_event, newDir: string) => {
      this.changeDir(newDir);
    });
  }

  // ─────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────

  /**
   * Thực sự reload: dừng watcher cũ, đổi dir, scan lại, watch mới.
   * Gửi toàn bộ file list (hoặc [] nếu dir không tồn tại) đến renderer.
   */
  private async runReload(newDir: string): Promise<void> {
    console.log(`[IPSWWatcher] Reloading dir: ${newDir}`);

    await this.watcher?.close();
    this.watcher = null;
    this.watchDir = newDir;

    await this.scanExisting();
    this.beginWatch();

    // Thông báo renderer toàn bộ danh sách hiện tại
    this.sendReload(this.getFiles());
  }

  /** Quét thư mục lần đầu để lấy các tệp .ipsw sẵn có. */
  private async scanExisting(): Promise<void> {
    this.files = new Map();

    let entries: string[];
    try {
      entries = await fs.readdir(this.watchDir);
    } catch {
      // Thư mục chưa tồn tại – bỏ qua, chokidar sẽ watch khi có
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

  /** Tạo và khởi động chokidar watcher. */
  private beginWatch(): void {
    this.watcher = chokidar.watch(this.watchDir, {
      ignored: (filePath: string) => {
        const isDir = !path.extname(filePath);
        return !isDir && !filePath.toLowerCase().endsWith(".ipsw");
      },
      persistent: true,
      ignoreInitial: true, // đã scan thủ công ở trên
      depth: 0,            // chỉ watch flat (không đệ quy)
      awaitWriteFinish: {
        stabilityThreshold: 3000,
        pollInterval: 500,
      },
    });

    this.watcher.on("add", (filePath) => void this.onAdded(filePath));
    this.watcher.on("unlink", (filePath) => this.onRemoved(filePath));
    this.watcher.on("error", (err) =>
      console.error("[IPSWWatcher] watcher error:", err)
    );
  }

  private async onAdded(filePath: string): Promise<void> {
    console.log(`[IPSWWatcher] File write finished: ${filePath}`);

    const file = await this.buildIPSWFile(filePath);
    if (!file) return;

    this.files.set(filePath, file);
    this.sendReload([file]);
  }

  private onRemoved(filePath: string): void {
    if (!this.files.has(filePath)) return;
    this.files.delete(filePath);
    this.sendReload([]);
  }

  /** Gửi event `ipsw:reload` kèm danh sách file. */
  private sendReload(files: IPSWFile[]): void {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send(IPSW_IPC.RELOAD, files);
  }

  /** Đọc stat và tạo IPSWFile; trả về null nếu lỗi. */
  private async buildIPSWFile(filePath: string): Promise<IPSWFile | null> {
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
}
