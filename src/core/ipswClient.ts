type ReloadListener = (files: IPSWFile[]) => void;

/**
 * Client chạy ở renderer process.
 *
 * - Giữ một bản sao local của danh sách file để đọc đồng bộ.
 * - Lắng nghe event `ipsw:reload` từ main để cập nhật list.
 * - Cung cấp API giao tiếp với IPSWWatcher bên main.
 */
export class IPSWClient {
    private files: Map<string, IPSWFile> = new Map();
    private listeners: Set<ReloadListener> = new Set();

    constructor() {
        window.api.file.onReload((f) => this.applyReload(f));
        this.init()
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

    // ─────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────

    /**
     * Xử lý payload từ main:
     * - Nếu `incoming` có phần tử → đây là file vừa được thêm, merge vào map.
     * - Nếu `incoming` rỗng → có file bị xoá; đồng bộ lại từ main.
     *
     * Sau khi changeDir, main gửi toàn bộ list mới → ghi đè hoàn toàn.
     */
    private applyReload(incoming: IPSWFile[]): void {
        if (incoming.length > 0) {
            // Thêm/cập nhật các file mới
            for (const f of incoming) {
                this.files.set(f.path, f);
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

    private emit(files: IPSWFile[]): void {
        for (const listener of this.listeners) {
            listener(files);
        }
    }
}