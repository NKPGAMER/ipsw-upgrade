"use strict";
/**
 * preload.ts
 *
 * Add to your Electron BrowserWindow:
 *   webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true }
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("./types");
const listeners = new Set();
// Forward IPC events from main to all registered listeners
electron_1.ipcRenderer.on(types_1.IPC.EVENT, (_ipcEvent, event) => {
    for (const fn of listeners)
        fn(event);
});
electron_1.contextBridge.exposeInMainWorld("downloadManager", {
    /**
     * Add a new download task.
     * @returns Promise<string> — task ID
     */
    add: (url, destPath, priority) => electron_1.ipcRenderer.invoke(types_1.IPC.ADD, url, destPath, priority),
    pause: (id) => electron_1.ipcRenderer.invoke(types_1.IPC.PAUSE, id),
    resume: (id) => electron_1.ipcRenderer.invoke(types_1.IPC.RESUME, id),
    cancel: (id) => electron_1.ipcRenderer.invoke(types_1.IPC.CANCEL, id),
    pauseAll: () => electron_1.ipcRenderer.invoke(types_1.IPC.PAUSE_ALL),
    resumeAll: () => electron_1.ipcRenderer.invoke(types_1.IPC.RESUME_ALL),
    /** Get snapshot of all tasks */
    getAll: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_ALL),
    /** Update queue order — pass ordered array of task IDs */
    updateQueue: (orderedIds) => electron_1.ipcRenderer.invoke(types_1.IPC.UPDATE_QUEUE, orderedIds),
    /** Subscribe to download events from main process */
    onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
});
