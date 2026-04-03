"use strict";
/**
 * ipcBridge.ts
 *
 * Register this in your Electron main process:
 *   import { registerDownloadManagerIPC } from "./ipcBridge";
 *   registerDownloadManagerIPC(mainWindow);
 *
 * In preload.ts, expose the renderer API via contextBridge.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manager = void 0;
exports.registerDownloadManagerIPC = registerDownloadManagerIPC;
const electron_1 = require("electron");
const DownloadManager_1 = require("./DownloadManager");
const types_1 = require("./types");
let manager;
function registerDownloadManagerIPC(win, opts = {}) {
    exports.manager = manager = new DownloadManager_1.DownloadManager(opts);
    // ── Forward events to renderer ─────────────────────────────────────────────
    manager.on("event", (event) => {
        if (!win.isDestroyed()) {
            win.webContents.send(types_1.IPC.EVENT, event);
        }
    });
    manager.on("network-offline", () => {
        if (!win.isDestroyed()) {
            win.webContents.send(types_1.IPC.EVENT, {
                id: "__global__",
                type: "state",
                payload: { networkOnline: false },
            });
        }
    });
    manager.on("network-online", () => {
        if (!win.isDestroyed()) {
            win.webContents.send(types_1.IPC.EVENT, {
                id: "__global__",
                type: "state",
                payload: { networkOnline: true },
            });
        }
    });
    // ── IPC handlers ────────────────────────────────────────────────────────────
    // Add a new download
    electron_1.ipcMain.handle(types_1.IPC.ADD, (_e, url, destPath, priority) => {
        return manager.add(url, destPath, priority);
    });
    // Pause a task
    electron_1.ipcMain.handle(types_1.IPC.PAUSE, (_e, id) => {
        manager.pause(id);
    });
    // Resume a task
    electron_1.ipcMain.handle(types_1.IPC.RESUME, (_e, id) => {
        manager.resume(id);
    });
    // Cancel a task
    electron_1.ipcMain.handle(types_1.IPC.CANCEL, (_e, id) => {
        manager.cancel(id);
    });
    // Pause all
    electron_1.ipcMain.handle(types_1.IPC.PAUSE_ALL, () => {
        manager.pauseAll();
    });
    // Resume all
    electron_1.ipcMain.handle(types_1.IPC.RESUME_ALL, () => {
        manager.resumeAll();
    });
    // Get all tasks (snapshot)
    electron_1.ipcMain.handle(types_1.IPC.GET_ALL, () => {
        return manager.getAll();
    });
    // Update queue order
    electron_1.ipcMain.handle(types_1.IPC.UPDATE_QUEUE, (_e, orderedIds) => {
        manager.updateQueue(orderedIds);
    });
    // ── App lifecycle ──────────────────────────────────────────────────────────
    electron_1.app.on("before-quit", async (e) => {
        e.preventDefault();
        await manager.onExit();
        electron_1.app.exit(0);
    });
}
