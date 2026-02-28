import downloadFirmware from "./downloadFirmware.js";
import utils from "./utils.js";
/* ================= UPGRADE MANAGER ================= */
class UpgradeManager {
    constructor() {
        /* ===== CORE STATE ===== */
        this.state = "IDLE";
        this.maxStream = 3;
        this.pending = [];
        this.running = new Map();
        this.completed = [];
        this.failed = [];
        /* ===== UI ELEMENTS ===== */
        this.overlay = null;
    }
    /* ================= INIT ================= */
    init() {
        this.overlay = document.getElementById("upgradeOverlay");
        this.bindButtons();
        this.bindDownloaderEvents();
    }
    /* ================= PUBLIC API ================= */
    setQueue(files) {
        this.reset();
        this.pending = [...files];
        this.renderAll();
    }
    start() {
        if (this.state === "RUNNING")
            return;
        this.state = "RUNNING";
        this.renderButtons();
        this.tick();
    }
    pause() {
        if (this.state !== "RUNNING")
            return;
        this.state = "PAUSED";
        this.renderButtons();
    }
    resume() {
        if (this.state !== "PAUSED")
            return;
        this.state = "RUNNING";
        this.renderButtons();
        this.tick();
    }
    stop() {
        this.state = "STOPPED";
        this.reset();
        this.renderAll();
    }
    show() {
        this.overlay?.classList.remove('hidden');
    }
    /* ================= CORE ENGINE ================= */
    tick() {
        if (this.state !== "RUNNING")
            return;
        while (this.running.size < this.maxStream &&
            this.pending.length > 0) {
            const file = this.pending.shift();
            this.startTask(file);
        }
        this.renderAll();
        if (this.pending.length === 0 && this.running.size === 0) {
            this.onAllDone();
        }
    }
    startTask(file) {
        const url = file.latestFirmware.url;
        this.running.set(url, file);
        // Xóa firmware cũ
        if (file.oldFiles.length > 0) {
            Promise.allSettled(file.oldFiles.map(f => window.api.deleteFile(f.path)));
        }
        downloadFirmware.download(file.latestFirmware, file.device);
    }
    /* ================= DOWNLOADER CALLBACK ================= */
    bindDownloaderEvents() {
        window.downloader.onDownloadProgress(d => {
            this.updateProgress(d.url, d.progress);
        });
        window.downloader.onDownloadComplete(d => {
            this.onCompleted(d.request.firmware.url);
        });
        window.downloader.onDownloadError(d => {
            this.onFailed(d.request.firmware.url, d.error);
        });
    }
    onCompleted(url) {
        const file = this.running.get(url);
        if (!file)
            return;
        this.running.delete(url);
        this.completed.push(file);
        this.tick();
    }
    onFailed(url, error) {
        const file = this.running.get(url);
        if (!file)
            return;
        this.running.delete(url);
        this.failed.push(file);
        utils.showErrorMessage(`Lỗi tải ${file.latestFirmware.version}: ${error}`);
        this.tick();
    }
    /* ================= UI ================= */
    bindButtons() {
        document.getElementById("startUpgrade")
            ?.addEventListener("click", () => this.start());
        document.getElementById("pauseAll")
            ?.addEventListener("click", () => {
            this.state === "RUNNING" ? this.pause() : this.resume();
        });
        document.getElementById("closeUpgradeOverlay")
            ?.addEventListener("click", () => this.stop());
    }
    renderAll() {
        this.renderSummary();
        this.renderLists();
        this.renderButtons();
    }
    renderSummary() {
        document.getElementById("pendingCount").textContent =
            this.pending.length.toString();
        document.getElementById("runningCount").textContent =
            this.running.size.toString();
        document.getElementById("completedCount").textContent =
            (this.completed.length + this.failed.length).toString();
    }
    renderLists() {
        this.renderList("pendingList", this.pending, "pending");
        this.renderList("runningList", [...this.running.values()], "running");
        this.renderList("completedList", [...this.completed, ...this.failed], "completed");
    }
    renderList(containerId, files, status) {
        const el = document.getElementById(containerId);
        if (!el)
            return;
        if (files.length === 0) {
            el.innerHTML = `<div class="empty-state">Trống</div>`;
            return;
        }
        el.innerHTML = files
            .map(f => this.createItemHTML(f, status))
            .join("");
    }
    renderButtons() {
        const startBtn = document.getElementById("startUpgrade");
        const pauseBtn = document.getElementById("pauseAll");
        if (!startBtn || !pauseBtn)
            return;
        startBtn.disabled = this.state === "RUNNING";
        pauseBtn.textContent =
            this.state === "RUNNING" ? "Tạm dừng" : "Tiếp tục";
    }
    updateProgress(url, progress) {
        const bar = document.querySelector(`[data-progress-url="${url}"]`);
        if (!bar)
            return;
        const percent = Math.round(progress * 100);
        bar.style.width = `${percent}%`;
    }
    createItemHTML(file, status) {
        const name = utils.getFileNameFromUrl(file.latestFirmware.url);
        return `
      <div class="upgrade-item ${status}">
        <div class="item-info">
          <div class="item-name">${file.latestFirmware.version}</div>
          <div class="item-device">${file.device.name}</div>
        </div>
        ${status === "running"
            ? `<div class="progress-bar">
                 <div class="progress-fill"
                      data-progress-url="${file.latestFirmware.url}"
                      style="width:0%"></div>
               </div>`
            : ""}
      </div>
    `;
    }
    /* ================= HELPERS ================= */
    reset() {
        this.pending = [];
        this.running.clear();
        this.completed = [];
        this.failed = [];
    }
    onAllDone() {
        utils.showSuccessMessage(`Hoàn thành: ${this.completed.length}, Lỗi: ${this.failed.length}`);
    }
}
/* ================= EXPORT ================= */
export const upgradeManager = new UpgradeManager();
export default upgradeManager;
