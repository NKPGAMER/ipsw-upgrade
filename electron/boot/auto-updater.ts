import { autoUpdater } from "electron-updater";
import { state, UPDATER_CHECK_DELAY } from "./app-state";

export interface UpdateStatus {
  phase: "idle" | "downloading" | "ready" | "no-update";
  version?: string;
  notes?: any;
  progress?: { percent: number; transferred: string; total: string };
}

let updateStatus: UpdateStatus = { phase: "idle" };

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload?: unknown) =>
    state.mainWindow?.webContents.send(channel, payload);

  autoUpdater.on("update-available", ({ version, releaseNotes }) => {
    updateStatus = { ...updateStatus, phase: "downloading", version, notes: releaseNotes };
    send("update-available", { version, notes: releaseNotes });
  });

  autoUpdater.on("update-not-available", () => {
    updateStatus = { ...updateStatus, phase: "no-update" };
    send("update-not-available");
  });

  autoUpdater.on("update-downloaded", () => {
    updateStatus = { ...updateStatus, phase: "ready" };
    send("update-ready");
  });

  autoUpdater.on("download-progress", ({ percent, transferred, total }) => {
    const progress = {
      percent: Math.round(percent),
      transferred: (transferred / 1048576).toFixed(2),
      total: (total / 1048576).toFixed(2),
    };
    updateStatus = { ...updateStatus, progress };
    send("update-progress", progress);
  });

  autoUpdater.on("error", (err) => {
    console.error("[autoUpdater] error:", err);
    updateStatus = { ...updateStatus, phase: "idle" };
    send("update-error", { message: err.message });
  });

  setTimeout(() => autoUpdater.checkForUpdates(), UPDATER_CHECK_DELAY);
}
