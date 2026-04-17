type ReloadListener = (files: IPSWFile[]) => void;
type IncompleteTasksListener = (tasks: IncompleteTaskClient[]) => void;

export interface IncompleteTaskClient {
  id: string;
  firmware: IncompleteTaskFirmware;
  savePath: string;
  tmpPath: string;
  totalSize: number;
  downloadedBytes: number;
  progress: number;
  tmpExists: boolean;
  savedAt: number;
}

interface IncompleteTaskFirmware {
  identifier: string;
  version: string;
  buildid: string;
  sha1sum: string;
  md5sum: string;
  sha256sum: string;
  filesize: number;
  url: string;
  releasedate: string;
  uploaddate: string;
  signed: boolean;
}

/**
 * Client chạy ở renderer process.
 *
 * - Giữ một bản sao local của danh sách file để đọc đồng bộ.
 * - Lắng nghe event `ipsw:reload` từ main để cập nhật list.
 * - Cung cấp API giao tiếp với IPSWWatcher bên main.
 * - Quản lý danh sách incomplete tasks và tự xóa khi file tương ứng được thêm.
 */
export class IPSWClient {
    private files: Map<string, IPSWFile> = new Map();
    private listeners: Set<ReloadListener> = new Set();

    private incompleteTasks: Map<string, IncompleteTaskClient> = new Map(); // key = task id
    private incompleteListeners: Set<IncompleteTasksListener> = new Set();

    constructor() {
        window.api.file.onReload((f) => this.applyReload(f));
        void this.init().then(() => this.initIncompleteTasks());
    }

    // ─────────────────────────────────────────
    // Khởi tạo
    // ─────────────────────────────────────────

    /**
     * Gọi một lần sau khi khởi tạo để đồng bộ trạng thái ban đầu từ main.
     */
    async init(): Promise<void> {
        const files = await window.api.file.getFiles();
        this.files = new Map(files.map((f) => [f.path, f]));
        this.emit(this.getFiles());
    }

    /**
     * Lấy danh sách incomplete tasks từ downloader và lưu vào bộ nhớ local.
     */
    async initIncompleteTasks(): Promise<void> {
        const load = async () => {
            const tasks = await window.downloader.getIncompleteTasks() as unknown as IncompleteTaskClient[];
            if (!Array.isArray(tasks)) return;
            this.incompleteTasks = new Map(tasks.map((t) => [t.id, t]));
            this.emitIncompleteTasks();
        };

        try {
            await load();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("No handler registered for 'dm:getIncompleteTasks'")) {
                await new Promise((resolve) => setTimeout(resolve, 150));
                try {
                    await load();
                    return;
                } catch (retryErr) {
                    console.error("[IPSWClient] initIncompleteTasks retry failed:", retryErr);
                    return;
                }
            }
            console.error("[IPSWClient] initIncompleteTasks failed:", err);
        }
    }

    // ─────────────────────────────────────────
    // Public API — đọc dữ liệu
    // ─────────────────────────────────────────

    /** Trả về bản sao danh sách file hiện tại (đồng bộ). */
    getFiles(): IPSWFile[] {
        return [...this.files.values()];
    }

    /** Lấy một file theo path. */
    getFile(filePath: string): IPSWFile | undefined {
        return this.files.get(filePath);
    }

    /** Trả về danh sách incomplete tasks hiện tại (đồng bộ). */
    getIncompleteTasks(): IncompleteTaskClient[] {
        return [...this.incompleteTasks.values()];
    }

    /**
     * Tìm incomplete task theo firmware identifier + buildid.
     * Dùng để kiểm tra xem một device có file tải dở không.
     */
    findIncompleteTaskByFirmware(identifier: string, buildid: string): IncompleteTaskClient | undefined {
        for (const task of this.incompleteTasks.values()) {
            if (
                task.firmware.identifier === identifier &&
                task.firmware.buildid === buildid
            ) {
                return task;
            }
        }
        return undefined;
    }

    // ─────────────────────────────────────────
    // Public API — gửi lệnh đến main
    // ─────────────────────────────────────────

    /**
     * Đổi thư mục theo dõi.
     * Main sẽ debounce: chờ task hiện tại xong rồi nhảy sang request cuối nhất.
     */
    changeDir(newDir: string): void {
        window.api.file.changeDir(newDir);
    }

    /**
     * Xoá một hoặc nhiều file.
     * Truyền vào path (string | string[]) hoặc IPSWFile | IPSWFile[].
     */
    async deleteFile(
        target: string | string[] | IPSWFile | IPSWFile[]
    ): Promise<void> {
        await window.api.file.delete(target);
    }

    // ─────────────────────────────────────────
    // Subscriptions
    // ─────────────────────────────────────────

    /**
     * Đăng ký callback được gọi mỗi khi danh sách file thay đổi.
     * Callback nhận toàn bộ danh sách hiện tại (sau khi đã cập nhật).
     * Trả về hàm huỷ đăng ký.
     */
    onReload(listener: ReloadListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Đăng ký callback được gọi mỗi khi danh sách incomplete tasks thay đổi.
     * Trả về hàm huỷ đăng ký.
     */
    onIncompleteTasksChanged(listener: IncompleteTasksListener): () => void {
        this.incompleteListeners.add(listener);
        return () => this.incompleteListeners.delete(listener);
    }

    /**
     * Cập nhật thủ công danh sách incomplete tasks từ downloader.
     * Gọi sau khi resumeIncomplete hoặc deleteIncomplete.
     */
    async refreshIncompleteTasks(): Promise<void> {
        await this.initIncompleteTasks();
    }

    /**
     * Xóa một incomplete task khỏi bộ nhớ local (không gọi API).
     * Dùng sau khi deleteIncomplete thành công.
     */
    removeIncompleteTask(taskId: string): void {
        if (this.incompleteTasks.has(taskId)) {
            this.incompleteTasks.delete(taskId);
            this.emitIncompleteTasks();
        }
    }

    // ─────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────

    /**
     * Xử lý payload từ main:
     * - Nếu `incoming` có phần tử → đây là file vừa được thêm, merge vào map.
     *   Đồng thời kiểm tra nếu firmware tương ứng có trong incompleteTasks thì xóa.
     * - Nếu `incoming` rỗng → có file bị xoá; đồng bộ lại từ main.
     *
     * Sau khi changeDir, main gửi toàn bộ list mới → ghi đè hoàn toàn.
     */
    private applyReload(incoming: IPSWFile[]): void {
        if (incoming.length > 0) {
            // Thêm/cập nhật các file mới
            for (const f of incoming) {
                this.files.set(f.path, f);

                // Kiểm tra xem file mới này có tương ứng với một incomplete task không
                this.checkAndRemoveIncompleteTask(f);
            }
            this.emit(this.getFiles());
        } else {
            window.api.file.getFiles()
                .then((files: IPSWFile[]) => {
                    this.files = new Map(files.map((f) => [f.path, f]));
                    this.emit(this.getFiles());
                })
                .catch((err) => console.error("[IPSWClient] sync error:", err));
        }
    }

    /**
     * Khi có file .ipsw mới được thêm vào, kiểm tra xem firmware đó có trong
     * incompleteTasks không. Nếu có thì xóa khỏi danh sách incomplete.
     *
     * Matching logic: So sánh tên file với url của firmware trong incomplete task.
     */
    private checkAndRemoveIncompleteTask(file: IPSWFile): void {
        let changed = false;
        for (const [taskId, task] of this.incompleteTasks.entries()) {
            // Lấy tên file từ URL của firmware trong task
            const expectedFileName = task.firmware.url.split("/").pop();
            if (expectedFileName && file.name === expectedFileName) {
                console.log(
                    `[IPSWClient] File "${file.name}" matched incomplete task ${taskId}, removing from incomplete list.`
                );
                this.incompleteTasks.delete(taskId);
                changed = true;
                // Không break — có thể có nhiều tasks trùng (edge case)
            }
        }
        if (changed) {
            this.emitIncompleteTasks();
        }
    }

    private emit(files: IPSWFile[]): void {
        for (const listener of this.listeners) {
            listener(files);
        }
    }

    private emitIncompleteTasks(): void {
        const tasks = this.getIncompleteTasks();
        for (const listener of this.incompleteListeners) {
            listener(tasks);
        }
    }
}