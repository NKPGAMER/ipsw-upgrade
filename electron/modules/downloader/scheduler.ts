import { EventEmitter } from "events";
import type { DownloadMode } from "./types";

export type DownloadEnvironment = "ssd_save" | "hdd_ssd_tmp" | "hdd_only";

export type SchedulerTask = {
  id: string;
  run: () => Promise<void>;
  onSlotOpen?: (slotType: DownloadMode) => void;
};

export class Scheduler extends EventEmitter {
  private maxConcurrent: number;
  private active = new Set<string>();
  private queue: SchedulerTask[] = [];
  private paused = new Set<string>();

  // ── Turbo mode state ─────────────────────────────────────────────────────
  private turboMode = false;
  private env: DownloadEnvironment = "ssd_save";
  private maxTurbo = 0;
  private maxNormal = 0;
  private activeTurbo = new Set<string>();
  private activeNormal = new Set<string>();

  constructor(maxConcurrent = 3) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  // ── Turbo mode configuration ─────────────────────────────────────────────

  setTurboMode(enabled: boolean, environment?: DownloadEnvironment): void {
    this.turboMode = enabled;
    if (environment) this.env = environment;
    if (enabled) {
      switch (this.env) {
        case "ssd_save":    this.maxTurbo = 2; this.maxNormal = 3; break;
        case "hdd_ssd_tmp": this.maxTurbo = 1; this.maxNormal = 2; break;
        case "hdd_only":    this.maxTurbo = 1; this.maxNormal = 1; break;
      }
    } else {
      this.maxTurbo = 0;
      this.maxNormal = 0;
    }
    // Kick drain to rebalance slots after limits change
    this.drain();
  }

  setEnvironment(env: DownloadEnvironment): void {
    this.env = env;
    if (this.turboMode) this.setTurboMode(true, env);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  enqueue(task: SchedulerTask): void {
    if (this.active.has(task.id) || this.queue.some(t => t.id === task.id)) return;
    this.queue.push(task);
    this.drain();
  }

  drain(): void {
    if (this.turboMode) {
      this.drainTurbo();
    } else {
      this.drainLegacy();
    }
  }

  private drainTurbo(): void {
    // Turbo only pulls from Normal (promotion), Normal only pulls from Queue.
    // Fill normal slots from queue — turbo slots are filled exclusively via
    // promoteNormalToTurbo() or tryFillTurboSlotFromQueue() (for the edge case
    // where all normal slots are full and their tasks are "moving", not "downloading").
    while (this.activeNormal.size < this.maxNormal && this.queue.length > 0) {
      const idx = this.queue.findIndex(t => !this.paused.has(t.id));
      if (idx === -1) break;
      const next = this.queue.splice(idx, 1)[0];
      this.activeNormal.add(next.id);
      this.active.add(next.id);
      next.onSlotOpen?.("normal");
      this.emit("started", next.id);
      next.run().finally(() => {
        this.activeNormal.delete(next.id);
        this.active.delete(next.id);
        this.emit("slot_open", next.id, "normal" as DownloadMode);
        this.drain();
      });
    }
  }

  /**
   * Edge case: all normal slots are full but their tasks are in "move" status
   * (not "downloading"). In this case, promote can't pull from normal, so we
   * assign a turbo slot directly from the queue.
   */
  tryFillTurboSlotFromQueue(): boolean {
    if (!this.turboMode) return false;
    if (this.activeTurbo.size >= this.maxTurbo) return false;
    const idx = this.queue.findIndex(t => !this.paused.has(t.id));
    if (idx === -1) return false;
    const next = this.queue.splice(idx, 1)[0];
    this.activeTurbo.add(next.id);
    this.active.add(next.id);
    next.onSlotOpen?.("turbo");
    this.emit("started", next.id);
    next.run().finally(() => {
      this.activeTurbo.delete(next.id);
      this.active.delete(next.id);
      this.emit("slot_open", next.id, "turbo" as DownloadMode);
      this.drain();
    });
    return true;
  }

  private drainLegacy(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const idx = this.queue.findIndex(t => !this.paused.has(t.id));
      if (idx === -1) break;

      const next = this.queue.splice(idx, 1)[0];
      this.active.add(next.id);
      this.emit("started", next.id);

      next.run().finally(() => {
        this.active.delete(next.id);
        this.emit("slot_open", next.id);
        this.drain();
      });
    }
  }

  pauseTask(id: string): void {
    this.paused.add(id);
  }

  resumeTask(id: string): void {
    this.paused.delete(id);
    this.drain();
  }

  cancelTask(id: string): void {
    const wasQueued = this.queue.some(t => t.id === id);
    this.queue = this.queue.filter(t => t.id !== id);
    this.paused.delete(id);
    this.activeTurbo.delete(id);
    this.activeNormal.delete(id);

    // Active tasks release their slot when the in-flight promise settles.
    if (wasQueued && !this.active.has(id)) {
      this.drain();
    }
  }

  // ── Promotion ────────────────────────────────────────────────────────────

  promoteNormalToTurbo(id: string): boolean {
    if (!this.activeNormal.has(id)) return false;
    if (this.activeTurbo.size >= this.maxTurbo) return false;
    this.activeNormal.delete(id);
    this.activeTurbo.add(id);
    this.emit("promoted", id);
    return true;
  }

  hasFreeTurboSlot(): boolean {
    return this.turboMode && this.activeTurbo.size < this.maxTurbo;
  }

  hasFreeNormalSlot(): boolean {
    return this.turboMode && this.activeNormal.size < this.maxNormal;
  }

  getMaxNormal(): number {
    return this.turboMode ? this.maxNormal : this.maxConcurrent;
  }

  /** All normal slots are occupied (regardless of task state) */
  areAllNormalSlotsFull(): boolean {
    if (!this.turboMode) return false;
    return this.activeNormal.size >= this.maxNormal;
  }

  getActiveNormalDownloadingIds(): string[] {
    return Array.from(this.activeNormal);
  }

  getActiveTurboCount(): number {
    return this.activeTurbo.size;
  }

  getActiveNormalCount(): number {
    return this.activeNormal.size;
  }

  // ── Read-only queries ────────────────────────────────────────────────────

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.some(t => t.id === id);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.active.size;
  }
}
