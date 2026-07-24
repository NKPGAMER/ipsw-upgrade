import type { Task, AddResult, IncompleteTask, AddOptions, DownloadManagerOptions, LifecycleResult } from "@custom-type/downloader";
import type { IPSWFirmware } from "@custom-type/ipswAPI";
import type { VerifyProgressInfo, VerifyCompletedInfo, VerifyCancelledInfo, VerifyErrorInfo } from "@custom-type/preload";

type Listener = (...args: any[]) => void;

interface DownloaderEventMap {
    [key: string]: Listener;
    added: (taskId: string, task: Task) => void;
    cancelled: (taskId: string) => void;
    completed: (taskId: string, task: Task) => void;
    error: (taskId: string, error: string, task: Task) => void;
    incomplete_deleted: (taskId: string) => void;
    paused: (taskId: string, task: Task) => void;
    progress: (taskId: string, task: Task) => void;
    resumed: (taskId: string, task?: Task) => void;
    started: (taskId: string, task: Task) => void;
    verify_progress: (info: VerifyProgressInfo) => void;
    verify_completed: (info: VerifyCompletedInfo) => void;
    verify_cancelled: (info: VerifyCancelledInfo) => void;
    verify_error: (info: VerifyErrorInfo) => void;
}

class EventBus<M extends Record<string, Listener>> {
    private listeners = new Map<keyof M, Set<Listener>>();

    emit<E extends keyof M>(event: E, ...args: Parameters<M[E]>): void {
        const set = this.listeners.get(event);
        if (!set) return;
        set.forEach((fn) => { fn(...args); });
    }

    on<E extends keyof M>(event: E, callback: M[E]): { unsubscribe: () => void } {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(callback);
        return {
            unsubscribe: () => {
                set!.delete(callback);
                if (set!.size === 0) this.listeners.delete(event);
            },
        };
    }

    off<E extends keyof M>(event: E, callback: M[E]): void {
        this.listeners.get(event)?.delete(callback);
    }
}

class Downloader {
    private emitter = new EventBus<DownloaderEventMap>();
    private api = window.downloader;

    constructor() {
        if (!this.api) throw new Error("The 'window.downloader' API does not exist.");

        this.registerApiEvents();
    }

    private registerApiEvents() {
        this.api.onAdded((id, task) => this.emitter.emit("added", id, task));
        this.api.onCancelled((id) => this.emitter.emit("cancelled", id));
        this.api.onCompleted((id, task) => this.emitter.emit("completed", id, task));
        this.api.onError((id, error, task) => this.emitter.emit("error", id, error, task));
        this.api.onIncompleteDeleted((id) => this.emitter.emit("incomplete_deleted", id));
        this.api.onPaused((id, task) => this.emitter.emit("paused", id, task));
        this.api.onProgress((id, task) => this.emitter.emit("progress", id, task));
        this.api.onResumed((id, task) => this.emitter.emit("resumed", id, task));
        this.api.onStarted((id, task) => this.emitter.emit("started", id, task));
        this.api.onVerifyProgress((info) => this.emitter.emit("verify_progress", info));
        this.api.onVerifyCompleted((info) => this.emitter.emit("verify_completed", info));
        this.api.onVerifyCancelled((info) => this.emitter.emit("verify_cancelled", info));
        this.api.onVerifyError((info) => this.emitter.emit("verify_error", info));
    }

    on<E extends keyof DownloaderEventMap>(event: E, callback: DownloaderEventMap[E]): { unsubscribe: () => void } {
        return this.emitter.on(event, callback);
    }

    off<E extends keyof DownloaderEventMap>(event: E, callback: DownloaderEventMap[E]): this {
        this.emitter.off(event, callback);
        return this;
    }

    /* ── Events ── */

    onAdded(cb: DownloaderEventMap["added"]) { return this.on("added", cb); }
    onCancelled(cb: DownloaderEventMap["cancelled"]) { return this.on("cancelled", cb); }
    onCompleted(cb: DownloaderEventMap["completed"]) { return this.on("completed", cb); }
    onError(cb: DownloaderEventMap["error"]) { return this.on("error", cb); }
    onIncompleteDeleted(cb: DownloaderEventMap["incomplete_deleted"]) { return this.on("incomplete_deleted", cb); }
    onPaused(cb: DownloaderEventMap["paused"]) { return this.on("paused", cb); }
    onProgress(cb: DownloaderEventMap["progress"]) { return this.on("progress", cb); }
    onResumed(cb: DownloaderEventMap["resumed"]) { return this.on("resumed", cb); }
    onStarted(cb: DownloaderEventMap["started"]) { return this.on("started", cb); }
    onVerifyProgress(cb: DownloaderEventMap["verify_progress"]) { return this.on("verify_progress", cb); }
    onVerifyCompleted(cb: DownloaderEventMap["verify_completed"]) { return this.on("verify_completed", cb); }
    onVerifyCancelled(cb: DownloaderEventMap["verify_cancelled"]) { return this.on("verify_cancelled", cb); }
    onVerifyError(cb: DownloaderEventMap["verify_error"]) { return this.on("verify_error", cb); }

    /* ── Task lifecycle ── */

    async add(fw: IPSWFirmware, options?: AddOptions): Promise<AddResult> {
        return  await this.api?.add(fw, options) ?? {
            success: false,
            error: "UNKNOWN"
        }
    }

    async pause(id: string): Promise<LifecycleResult> {
        return this.api?.pause(id) ?? { success: false };
    }

    async resume(id: string): Promise<LifecycleResult> {
        return this.api?.resume(id) ?? { success: false };
    }

    async cancel(id: string): Promise<LifecycleResult> {
        return this.api?.cancel(id) ?? { success: false };
    }

    /* ── Queries ── */

    async getAllTask(): Promise<Task[]> {
        return this.api?.getAllTask() ?? [];
    }

    async getIncompleteTasks(): Promise<IncompleteTask> {
        return this.api?.getIncompleteTasks() ?? [];
    }

    async deleteIncomplete(id: string): Promise<{ success: boolean; error?: string }> {
        return this.api?.deleteIncomplete(id) ?? { success: false };
    }

    /* ── Config ── */

    async getConfig(): Promise<DownloadManagerOptions> {
        return this.api?.getConfig() ?? {};
    }

    async setConfig(partial: Partial<DownloadManagerOptions>): Promise<void> {
        return this.api?.setConfig(partial) ?? null;
    }

    /* ── Integrity / verify ── */

    async verifyChecksum(identifier: string, filePath: string, firmware: Firmware): Promise<void> {
        return this.api?.verifyChecksum(identifier, filePath, firmware) ?? null;
    }

    async cancelVerify(identifier: string): Promise<void> {
        return this.api?.cancelVerify(identifier) ?? null;
    }
}

export const downloader = new Downloader();