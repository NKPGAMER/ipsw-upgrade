import downloadFirmware from "./downloadFirmware.js";
import utils from "./utils.js";

/* ================= TYPES ================= */

type CoreState = "IDLE" | "RUNNING" | "PAUSED" | "STOPPED";

interface UpgradeFile {
  oldFiles: IPSWFile[];
  latestFirmware: Firmware;
  device: Device;
}

/* ================= UPGRADE MANAGER ================= */

class UpgradeManager {
  /* ===== CORE STATE ===== */

  private state: CoreState = "IDLE";
  private maxStream = 3;

  private pending: UpgradeFile[] = [];
  private running = new Map<string, UpgradeFile>();
  private completed: UpgradeFile[] = [];
  private failed: UpgradeFile[] = [];

  /* ===== UI ELEMENTS ===== */

  private overlay: HTMLElement | null = null;

  /* ================= INIT ================= */

  init(): void {
    this.overlay = document.getElementById("upgradeOverlay");

    this.bindButtons();
    this.bindDownloaderEvents();
  }

  /* ================= PUBLIC API ================= */

  setQueue(files: UpgradeFile[]): void {
    this.reset();
    this.pending = [...files];
    this.renderAll();
  }

  start(): void {
    if (this.state === "RUNNING") return;

    this.state = "RUNNING";
    this.renderButtons();
    this.tick();
  }

  pause(): void {
    if (this.state !== "RUNNING") return;

    this.state = "PAUSED";
    this.renderButtons();
  }

  resume(): void {
    if (this.state !== "PAUSED") return;

    this.state = "RUNNING";
    this.renderButtons();
    this.tick();
  }

  stop(): void {
    this.state = "STOPPED";
    this.reset();
    this.renderAll();
  }

  show() {
    this.overlay?.classList.remove('hidden')
  }

  /* ================= CORE ENGINE ================= */

  private tick(): void {
    if (this.state !== "RUNNING") return;

    while (
      this.running.size < this.maxStream &&
      this.pending.length > 0
    ) {
      const file = this.pending.shift()!;
      this.startTask(file);
    }

    this.renderAll();

    if (this.pending.length === 0 && this.running.size === 0) {
      this.onAllDone();
    }
  }

  private startTask(file: UpgradeFile): void {
    const url = file.latestFirmware.url;

    this.running.set(url, file);

    // Xóa firmware cũ
    if (file.oldFiles.length > 0) {
      Promise.allSettled(
        file.oldFiles.map(f => window.api.deleteFile(f.path))
      );
    }

    downloadFirmware.download(file.latestFirmware, file.device);
  }

  /* ================= DOWNLOADER CALLBACK ================= */

  private bindDownloaderEvents(): void {
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

  private onCompleted(url: string): void {
    const file = this.running.get(url);
    if (!file) return;

    this.running.delete(url);
    this.completed.push(file);

    this.tick();
  }

  private onFailed(url: string, error: string): void {
    const file = this.running.get(url);
    if (!file) return;

    this.running.delete(url);
    this.failed.push(file);

    utils.showErrorMessage(
      `Lỗi tải ${file.latestFirmware.version}: ${error}`
    );

    this.tick();
  }

  /* ================= UI ================= */

  private bindButtons(): void {
    document.getElementById("startUpgrade")
      ?.addEventListener("click", () => this.start());

    document.getElementById("pauseAll")
      ?.addEventListener("click", () => {
        this.state === "RUNNING" ? this.pause() : this.resume();
      });

    document.getElementById("closeUpgradeOverlay")
      ?.addEventListener("click", () => this.stop());
  }

  private renderAll(): void {
    this.renderSummary();
    this.renderLists();
    this.renderButtons();
  }

  private renderSummary(): void {
    document.getElementById("pendingCount")!.textContent =
      this.pending.length.toString();

    document.getElementById("runningCount")!.textContent =
      this.running.size.toString();

    document.getElementById("completedCount")!.textContent =
      (this.completed.length + this.failed.length).toString();
  }

  private renderLists(): void {
    this.renderList(
      "pendingList",
      this.pending,
      "pending"
    );

    this.renderList(
      "runningList",
      [...this.running.values()],
      "running"
    );

    this.renderList(
      "completedList",
      [...this.completed, ...this.failed],
      "completed"
    );
  }

  private renderList(
    containerId: string,
    files: UpgradeFile[],
    status: "pending" | "running" | "completed"
  ): void {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (files.length === 0) {
      el.innerHTML = `<div class="empty-state">Trống</div>`;
      return;
    }

    el.innerHTML = files
      .map(f => this.createItemHTML(f, status))
      .join("");
  }

  private renderButtons(): void {
    const startBtn = document.getElementById("startUpgrade") as HTMLButtonElement;
    const pauseBtn = document.getElementById("pauseAll") as HTMLButtonElement;

    if (!startBtn || !pauseBtn) return;

    startBtn.disabled = this.state === "RUNNING";

    pauseBtn.textContent =
      this.state === "RUNNING" ? "Tạm dừng" : "Tiếp tục";
  }

  private updateProgress(url: string, progress: number): void {
    const bar = document.querySelector(
      `[data-progress-url="${url}"]`
    ) as HTMLElement;

    if (!bar) return;

    const percent = Math.round(progress * 100);
    bar.style.width = `${percent}%`;
  }

  private createItemHTML(
    file: UpgradeFile,
    status: string
  ): string {
    const name = utils.getFileNameFromUrl(file.latestFirmware.url);

    return `
      <div class="upgrade-item ${status}">
        <div class="item-info">
          <div class="item-name">${file.latestFirmware.version}</div>
          <div class="item-device">${file.device.name}</div>
        </div>
        ${
          status === "running"
            ? `<div class="progress-bar">
                 <div class="progress-fill"
                      data-progress-url="${file.latestFirmware.url}"
                      style="width:0%"></div>
               </div>`
            : ""
        }
      </div>
    `;
  }

  /* ================= HELPERS ================= */

  private reset(): void {
    this.pending = [];
    this.running.clear();
    this.completed = [];
    this.failed = [];
  }

  private onAllDone(): void {
    utils.showSuccessMessage(
      `Hoàn thành: ${this.completed.length}, Lỗi: ${this.failed.length}`
    );
  }
}

/* ================= EXPORT ================= */

export const upgradeManager = new UpgradeManager();
export default upgradeManager;
