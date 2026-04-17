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
    // ── Task-aware debounce state ──────────────────────────────────────────────
    /** Promise của lần reload đang chạy. null = rảnh. */
    activeReload = null;
    /** Đường dẫn của request đang chờ (luôn giữ cái cuối nhất). */
    pendingDir = null;
    constructor(win, watchDir) {
        this.win = win;
        this.watchDir = watchDir;
        this.registerIpcHandlers();
    }
    normalizeDir(dir) {
        return path_1.default.resolve(dir).replace(/[\\\/]+$/, "").toLowerCase();
    }
    // ─────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────
    /** Khởi tạo: scan tất cả .ipsw hiện có rồi bắt đầu watch. */
    async start() {
        await this.scanExisting();
        this.beginWatch();
        this.sendReload(this.getFiles());
    }
    /** Dừng watcher, giải phóng tài nguyên và gỡ IPC handlers. */
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
    /** Trả về tất cả IPSWFile đang theo dõi. */
    getFiles() {
        return [...this.files.values()];
    }
    /**
     * Đổi thư mục theo dõi.
     *
     * Chiến lược debounce: nếu đang có task reload chạy, lưu dir mới vào
     * `pendingDir` (ghi đè liên tục). Khi task hiện tại xong sẽ tự nhảy sang
     * task mới nhất — bỏ qua mọi request ở giữa.
     */
    changeDir(newDir) {
        const nextDir = this.normalizeDir(newDir);
        const currentDir = this.normalizeDir(this.watchDir);
        const pendingDir = this.pendingDir ? this.normalizeDir(this.pendingDir) : null;
        if (nextDir === currentDir)
            return;
        if (pendingDir !== null && nextDir === pendingDir)
            return;
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
    async deleteFile(target) {
        const targets = Array.isArray(target) ? target : [target];
        const paths = targets.map((t) => (typeof t === "string" ? t : t.path));
        await Promise.all(paths.map((p) => promises_1.default.unlink(p)));
    }
    // ─────────────────────────────────────────
    // IPC handlers (renderer ↔ main)
    // ─────────────────────────────────────────
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
    // ─────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────
    /**
     * Thực sự reload: dừng watcher cũ, đổi dir, scan lại, watch mới.
     * Gửi toàn bộ file list (hoặc [] nếu dir không tồn tại) đến renderer.
     */
    async runReload(newDir) {
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
    async scanExisting() {
        this.files = new Map();
        let entries;
        try {
            entries = await promises_1.default.readdir(this.watchDir);
        }
        catch {
            // Thư mục chưa tồn tại – bỏ qua, chokidar sẽ watch khi có
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
    /** Tạo và khởi động chokidar watcher. */
    beginWatch() {
        this.watcher = chokidar_1.default.watch(this.watchDir, {
            ignored: (filePath) => {
                const isDir = !path_1.default.extname(filePath);
                return !isDir && !filePath.toLowerCase().endsWith(".ipsw");
            },
            persistent: true,
            ignoreInitial: true, // đã scan thủ công ở trên
            depth: 0, // chỉ watch flat (không đệ quy)
            awaitWriteFinish: {
                stabilityThreshold: 3000,
                pollInterval: 500,
            },
        });
        this.watcher.on("add", (filePath) => void this.onAdded(filePath));
        this.watcher.on("unlink", (filePath) => void this.onRemoved(filePath));
        this.watcher.on("error", (err) => console.error("[IPSWWatcher] watcher error:", err));
    }
    async onAdded(filePath) {
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
        this.files.delete(filePath);
        this.sendReload([]);
        await Promise.all([...this.removedCallbacks].map((callback) => Promise.resolve(callback([file]))));
    }
    /** Gửi event `ipsw:reload` kèm danh sách file. */
    sendReload(files) {
        if (this.win.isDestroyed())
            return;
        this.win.webContents.send(exports.IPSW_IPC.RELOAD, files);
    }
    /** Đọc stat và tạo IPSWFile; trả về null nếu lỗi. */
    async buildIPSWFile(filePath) {
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
}
exports.IPSWWatcher = IPSWWatcher;
