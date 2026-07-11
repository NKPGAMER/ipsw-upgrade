import { listen } from "@tauri-apps/api/event";
import { commands, type Task, type AddResult, type LifecycleResult, type IncompleteTask, type DiskEnvironmentInfo } from "../bind";

// ─── Event payload types ──────────────────────────────────────────────────────

interface EventWithTask { task_id: string; task: Task }
interface EventError { task_id: string; error: string; task: Task }
interface EventCancelled { task_id: string }
interface EventIncompleteDeleted { id: string }

type EventCallback<T> = (payload: T) => void;

function unwrap<T>(result: { status: "ok"; data: T } | { status: "error"; error: string }): T {
  if (result.status === "ok") return result.data;
  throw new Error(result.error);
}

type Sub = { unsubscribe: () => void };

// ─── DownloaderBridge ─────────────────────────────────────────────────────────

export const downloader = {
  async add(firmware: Parameters<typeof commands.dmAdd>[0], savePath: string): Promise<AddResult> {
    return unwrap(await commands.dmAdd(firmware, savePath));
  },

  async pause(id: string): Promise<LifecycleResult> {
    return unwrap(await commands.dmPause(id));
  },

  async resume(id: string): Promise<LifecycleResult> {
    return unwrap(await commands.dmResume(id));
  },

  async cancel(id: string): Promise<LifecycleResult> {
    return unwrap(await commands.dmCancel(id));
  },

  async getAllTasks(): Promise<Task[]> {
    return unwrap(await commands.dmGetAllTasks());
  },

  get getAllTask() { return this.getAllTasks; },

  async getIncompleteTasks(): Promise<IncompleteTask[]> {
    return unwrap(await commands.dmGetIncompleteTasks());
  },

  async resumeIncomplete(id: string): Promise<LifecycleResult> {
    return unwrap(await commands.dmResumeIncomplete(id));
  },

  async deleteIncomplete(id: string): Promise<LifecycleResult> {
    return unwrap(await commands.dmDeleteIncomplete(id));
  },

  async getEnvironmentInfo(savePath: string): Promise<DiskEnvironmentInfo> {
    return unwrap(await commands.dmGetEnvironmentInfo(savePath));
  },

  setBoost(enabled: boolean): Promise<void> {
    return commands.dmSetBoost(enabled);
  },

  // ─── Event Subscriptions ──────────────────────────────────────────────────

  sub(channel: string, cb: (payload: any) => void): { subscribe: () => Sub } {
    return {
      subscribe: () => {
        const p = listen(channel, (e: any) => cb(e.payload));
        let unlisten: (() => void) | null = null;
        let done = false;
        p.then(
          (u) => { if (!done) unlisten = u; },
          () => {}
        );
        return {
          unsubscribe() {
            done = true;
            if (unlisten) unlisten();
          },
        };
      },
    };
  },

  onAdded(cb: EventCallback<EventWithTask>): Sub {
    const p = listen<any>("dm:added", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onProgress(cb: EventCallback<EventWithTask>): Sub {
    const p = listen<any>("dm:progress", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onCompleted(cb: EventCallback<EventWithTask>): Sub {
    const p = listen<any>("dm:completed", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onError(cb: EventCallback<EventError>): Sub {
    const p = listen<any>("dm:error", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onPaused(cb: EventCallback<EventWithTask>): Sub {
    const p = listen<any>("dm:paused", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onResumed(cb: EventCallback<EventWithTask>): Sub {
    const p = listen<any>("dm:resumed", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onCancelled(cb: EventCallback<EventCancelled>): Sub {
    const p = listen<any>("dm:cancelled", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },

  onIncompleteDeleted(cb: EventCallback<EventIncompleteDeleted>): Sub {
    const p = listen<any>("dm:incomplete_deleted", (e) => cb(e.payload));
    let u: (() => void) | null = null;
    let done = false;
    p.then((fn) => { if (!done) u = fn; }, () => {});
    return { unsubscribe() { done = true; if (u) u(); } };
  },
};
