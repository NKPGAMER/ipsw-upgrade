"use strict";
/**
 * downloader-main.ts
 *
 * Main-thread orchestrator.
 *
 * Responsibilities:
 *  1. Spawn the downloader Worker thread (downloader-worker.ts)
 *  2. Provide a request/reply bridge for async Worker calls (add, getAllTask, …)
 *  3. Forward spontaneous Worker events → BrowserWindow.webContents.send (renderer)
 *  4. Register ipcMain handlers so the renderer can invoke downloader methods
 *
 * Usage (in your main Electron entry-point):
 *
 *   import { DownloaderMain } from "./downloader/downloader-main";
 *
 *   const downloader = new DownloaderMain(mainWindow, {
 *     stateDir: path.join(app.getPath("userData"), ".ipsw-state"),
 *     config: { maxConcurrentTasks: 3 },
 *   });
 *
 *   // On window close / app quit:
 *   await downloader.destroy();
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloaderMain = void 0;
const path = __importStar(require("path"));
const worker_threads_1 = require("worker_threads");
const crypto_1 = require("crypto");
class DownloaderMain {
    worker = null;
    win;
    stateDir;
    config;
    pending = new Map();
    constructor(win, opts = { stateDir: ".ipsw-state" }) {
        this.win = win;
        this.stateDir = opts.stateDir;
        this.config = opts.config ?? {};
        this.registerIPC();
    }
    ensureWorker() {
        if (this.worker)
            return this.worker;
        this.worker = new worker_threads_1.Worker(path.join(__dirname, "downloader-worker.js"), {
            workerData: {
                stateDir: this.stateDir,
                config: this.config,
            },
            resourceLimits: { maxOldGenerationSizeMb: 256 },
        });
        this.worker.on("message", (msg) => this.handleWorkerMessage(msg));
        this.worker.on("error", (err) => console.error("[DownloaderMain] worker error:", err));
        this.worker.on("exit", (code) => {
            if (code !== 0)
                console.error(`[DownloaderMain] worker exited with code ${code}`);
            this.worker = null;
        });
        return this.worker;
    }
    // ─── Worker message handler ───────────────────────────────────────────────
    handleWorkerMessage(msg) {
        if (msg.type === "reply") {
            const pending = this.pending.get(msg.reqId);
            if (pending) {
                this.pending.delete(msg.reqId);
                msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg.result);
            }
            return;
        }
        if (msg.type === "event") {
            const { channel, ...rest } = msg;
            this.sendToRenderer(channel, rest);
        }
    }
    // ─── Request / reply helper ───────────────────────────────────────────────
    call(msg) {
        return new Promise((resolve, reject) => {
            const reqId = (0, crypto_1.randomUUID)();
            this.pending.set(reqId, { resolve, reject });
            this.ensureWorker().postMessage({ ...msg, reqId });
        });
    }
    // ─── Public API ───────────────────────────────────────────────────────────
    add(firmware, savePath, config = {}) {
        return this.call({ type: "add", reqId: (0, crypto_1.randomUUID)(), firmware, savePath, config });
    }
    pause(id) { this.ensureWorker().postMessage({ type: "pause", id }); }
    resume(id) { this.ensureWorker().postMessage({ type: "resume", id }); }
    cancel(id) { this.ensureWorker().postMessage({ type: "cancel", id }); }
    getAllTask() {
        return this.call({ type: "getAllTask", reqId: (0, crypto_1.randomUUID)() });
    }
    getIncompleteTasks() {
        return this.call({ type: "getIncompleteTasks", reqId: (0, crypto_1.randomUUID)() });
    }
    resumeIncomplete(id) {
        return this.call({ type: "resumeIncomplete", reqId: (0, crypto_1.randomUUID)(), id });
    }
    deleteIncomplete(id) {
        return this.call({ type: "deleteIncomplete", reqId: (0, crypto_1.randomUUID)(), id });
    }
    /** Terminate the worker gracefully. Call on app quit. */
    async destroy() {
        if (!this.worker)
            return;
        const worker = this.worker;
        this.worker = null;
        await worker.terminate();
    }
    // ─── Renderer bridge ─────────────────────────────────────────────────────
    sendToRenderer(channel, payload) {
        if (!this.win || this.win.isDestroyed())
            return;
        const { taskId, task, error } = payload;
        switch (channel) {
            case "started":
            case "progress":
            case "completed":
            case "paused":
            case "resumed":
            case "added":
                this.win.webContents.send(`dm:${channel}`, taskId, task);
                break;
            case "error":
                this.win.webContents.send(`dm:${channel}`, taskId, error, task);
                break;
            case "cancelled":
            case "incomplete_deleted":
                this.win.webContents.send(`dm:${channel}`, taskId);
                break;
        }
    }
    // ─── IPC registration ─────────────────────────────────────────────────────
    registerIPC() {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        let ipcMain;
        try {
            ipcMain = require("electron").ipcMain;
        }
        catch {
            console.warn("[DownloaderMain] electron not available — IPC not registered");
            return;
        }
        const handlers = [
            ["dm:add", (_e, firmware, savePath) => this.add(firmware, savePath)],
            ["dm:pause", (_e, id) => { this.pause(id); }],
            ["dm:resume", (_e, id) => { this.resume(id); }],
            ["dm:cancel", (_e, id) => { this.cancel(id); }],
            ["dm:getAllTask", () => this.getAllTask()],
            ["dm:getIncompleteTasks", () => this.getIncompleteTasks()],
            ["dm:resumeIncomplete", (_e, id) => this.resumeIncomplete(id)],
            ["dm:deleteIncomplete", (_e, id) => this.deleteIncomplete(id)],
        ];
        for (const [channel, handler] of handlers) {
            try {
                ipcMain.removeHandler(channel);
            }
            catch { }
            ipcMain.handle(channel, handler);
        }
    }
}
exports.DownloaderMain = DownloaderMain;
