import { EventEmitter } from "events";
import type { DownloadMode } from "./types";

export type DownloadEnvironment = "ssd_save" | "hdd_ssd_tmp" | "hdd_only";

export type SchedulerTask = {
  id: string;
  run: () => Promise<void>;
  onSlotOpen?: (slotType: DownloadMode) => void;
  /** When true, the task must be assigned a turbo slot (never normal).
   *  drainTurbo skips these when filling normal slots. */
  turboPriority?: boolean;
};

/** Per-task connection budget used for dynamic rebalancing on ssd_save. */
export interface ConnectionBudget {
  current: number;
  base: number;
  speed?: number;
  progress?: number;
}

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
  private activeRunGens = new Map<string, number>();
  private tasks = new Map<string, SchedulerTask>();

  // ── Connection budget tracking (ssd_save dynamic rebalancing) ───────────
  private connectionBudgets = new Map<string, ConnectionBudget>();

  constructor(maxConcurrent = 3) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  // ── Turbo mode configuration ─────────────────────────────────────────────

  setTurboMode(enabled: boolean, environment: DownloadEnvironment): void {
    this.turboMode = enabled;
    this.env = environment;
    if (enabled) {
      switch (environment) {
        case "ssd_save": this.maxTurbo = 3; this.maxNormal = 1; break;
        case "hdd_ssd_tmp": this.maxTurbo = 1; this.maxNormal = 1; break;
        case "hdd_only": this.maxTurbo = 1; this.maxNormal = 1; break;
      }
    } else {
      this.maxTurbo = 0;
      this.maxNormal = 0;
      this.maxConcurrent = environment === "hdd_only" ? 2 : 3;
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
    this.tasks.set(task.id, task);
    this.queue.push(task);
    this.drain();
  }

  /** Update the turboPriority flag and onSlotOpen callback on a queued task. */
  updateQueueEntry(id: string, patch: { turboPriority?: boolean; onSlotOpen?: (slotType: DownloadMode) => void }): void {
    const stored = this.tasks.get(id);
    if (!stored) return;
    if (patch.turboPriority !== undefined) stored.turboPriority = patch.turboPriority;
    if (patch.onSlotOpen !== undefined) stored.onSlotOpen = patch.onSlotOpen;
    // Also update the in-queue copy so findIndex sees the new turboPriority
    const qi = this.queue.findIndex(t => t.id === id);
    if (qi !== -1) {
      if (patch.turboPriority !== undefined) this.queue[qi].turboPriority = patch.turboPriority;
      if (patch.onSlotOpen !== undefined) this.queue[qi].onSlotOpen = patch.onSlotOpen;
    }
  }

  drain(): void {
    if (this.turboMode) {
      this.drainTurbo();
    } else {
      this.drainLegacy();
    }
  }

  private drainTurbo(): void {
    // Fill normal slots from queue — skip turbo-priority tasks (they need turbo slots)
    while (this.activeNormal.size < this.maxNormal && this.queue.length > 0) {
      const idx = this.queue.findIndex(t => !this.paused.has(t.id) && !t.turboPriority);
      if (idx === -1) break;
      const next = this.queue.splice(idx, 1)[0];
      this.activeNormal.add(next.id);
      this.active.add(next.id);
      next.onSlotOpen?.("normal");
      this.emit("started", next.id);
      const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
      this.activeRunGens.set(next.id, gen);
      next.run().finally(() => {
        if (this.activeRunGens.get(next.id) !== gen) return;
        this.activeTurbo.delete(next.id);
        this.activeNormal.delete(next.id);
        this.active.delete(next.id);
        this.activeRunGens.delete(next.id);
        this.tasks.delete(next.id);
        this.connectionBudgets.delete(next.id);
        this.emit("slot_open", next.id, "normal" as DownloadMode);
        this.drain();
      });
    }
    // Fill all free turbo slots directly from the queue
    while (this.activeTurbo.size < this.maxTurbo) {
      if (!this.tryFillTurboSlotFromQueue()) break;
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
    // Prefer turbo-priority tasks, then fall back to any task
    let idx = this.queue.findIndex(t => t.turboPriority && !this.paused.has(t.id));
    if (idx === -1) idx = this.queue.findIndex(t => !this.paused.has(t.id));
    if (idx === -1) return false;
    const next = this.queue.splice(idx, 1)[0];
    this.activeTurbo.add(next.id);
    this.active.add(next.id);
    next.onSlotOpen?.("turbo");
    this.emit("started", next.id);
    const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
    this.activeRunGens.set(next.id, gen);
    next.run().finally(() => {
      if (this.activeRunGens.get(next.id) !== gen) return;
      this.activeTurbo.delete(next.id);
      this.activeNormal.delete(next.id);
      this.active.delete(next.id);
      this.activeRunGens.delete(next.id);
      this.tasks.delete(next.id);
      this.connectionBudgets.delete(next.id);
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
      const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
      this.activeRunGens.set(next.id, gen);
      next.run().finally(() => {
        if (this.activeRunGens.get(next.id) !== gen) return;
        this.activeTurbo.delete(next.id);
        this.activeNormal.delete(next.id);
        this.active.delete(next.id);
        this.activeRunGens.delete(next.id);
        this.tasks.delete(next.id);
        this.emit("slot_open", next.id);
        this.drain();
      });
    }
  }

  pauseTask(id: string): void {
    this.paused.add(id);
    const wasTurbo = this.activeTurbo.delete(id);
    const wasNormal = this.activeNormal.delete(id);
    const wasActive = wasTurbo || wasNormal || this.active.delete(id);
    // Invalidate old promise's finally() so it won't double-free the slot
    const gen = (this.activeRunGens.get(id) ?? 0) + 1;
    this.activeRunGens.set(id, gen);
    if (wasActive) {
      // Re-enqueue at the front so resume can pick it up
      const task = this.tasks.get(id);
      if (task) {
        this.queue.unshift(task);
      }
      if (wasTurbo) {
        this.emit("slot_open", id, "turbo" as DownloadMode);
      } else if (wasNormal) {
        this.emit("slot_open", id, "normal" as DownloadMode);
      }
    }
    this.drain();
  }

  resumeTask(id: string): void {
    this.paused.delete(id);
    this.drain();
  }

  cancelTask(id: string): void {
    this.queue = this.queue.filter(t => t.id !== id);
    this.paused.delete(id);
    const wasTurbo = this.activeTurbo.delete(id);
    const wasNormal = this.activeNormal.delete(id);
    this.active.delete(id);
    this.tasks.delete(id);
    this.connectionBudgets.delete(id);
    // Invalidate old promise's finally()
    const gen = (this.activeRunGens.get(id) ?? 0) + 1;
    this.activeRunGens.set(id, gen);
    if (wasTurbo || wasNormal) {
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

  getMaxTurbo(): number {
    return this.turboMode ? this.maxTurbo : 0;
  }

  /** All normal slots are occupied (regardless of task state) */
  areAllNormalSlotsFull(): boolean {
    if (!this.turboMode) return false;
    return this.activeNormal.size >= this.maxNormal;
  }

  getActiveNormalDownloadingIds(): string[] {
    return Array.from(this.activeNormal);
  }

  getActiveTurboIds(): string[] {
    return Array.from(this.activeTurbo);
  }

  getActiveTurboCount(): number {
    return this.activeTurbo.size;
  }

  /** Move a task from turbo to normal slot (must have a free normal slot). */
  demoteTurboToNormal(id: string): boolean {
    if (!this.activeTurbo.has(id)) return false;
    if (this.activeNormal.size >= this.maxNormal) return false;
    this.activeTurbo.delete(id);
    this.activeNormal.add(id);
    return true;
  }

  getActiveNormalCount(): number {
    return this.activeNormal.size;
  }

  // ── Connection budget tracking & rebalancing ───────────────────────────

  /** Register or update a turbo task's connection budget. */
  setConnectionBudget(id: string, budget: Partial<ConnectionBudget>): void {
    const existing = this.connectionBudgets.get(id) ?? { current: 4, base: 4 };
    if (budget.current !== undefined) existing.current = budget.current;
    if (budget.base !== undefined) existing.base = budget.base;
    if (budget.speed !== undefined) existing.speed = budget.speed;
    if (budget.progress !== undefined) existing.progress = budget.progress;
    this.connectionBudgets.set(id, existing);
  }

  getConnectionBudget(id: string): ConnectionBudget | undefined {
    return this.connectionBudgets.get(id);
  }

  clearConnectionBudget(id: string): void {
    this.connectionBudgets.delete(id);
  }

  /**
   * Dynamically rebalance connection budgets among active turbo tasks on ssd_save.
   * Tasks with higher speed get a larger share. Tasks that are falling behind in
   * progress get a boost to prevent starvation.
   */
  rebalanceTurboBudgets(totalBudget: number): Map<string, number> {
    if (this.env !== "ssd_save") return new Map();

    const turboIds = Array.from(this.activeTurbo);
    if (turboIds.length === 0) return new Map();
    if (turboIds.length === 1) {
      const single = turboIds[0];
      this.setConnectionBudget(single, { current: totalBudget });
      return new Map([[single, totalBudget]]);
    }

    const budgets = turboIds.map(id => this.connectionBudgets.get(id) ?? { current: 4, base: 4 });
    const totalSpeed = budgets.reduce((sum, b) => sum + (b.speed ?? 0), 0);
    const result = new Map<string, number>();

    if (totalSpeed === 0) {
      // No speed data yet — distribute evenly
      const even = Math.floor(totalBudget / turboIds.length);
      let remainder = totalBudget;
      for (const id of turboIds) {
        const share = remainder >= even * 2 ? even : remainder;
        this.setConnectionBudget(id, { current: share });
        result.set(id, share);
        remainder -= share;
      }
    } else {
      // Distribute 70% by speed proportion, 30% as base floor to prevent starvation
      const speedPool = Math.floor(totalBudget * 0.7);
      const floorPool = totalBudget - speedPool;
      const floorShare = Math.floor(floorPool / turboIds.length);
      let remainder = totalBudget;

      for (let i = 0; i < turboIds.length; i++) {
        const id = turboIds[i];
        const b = budgets[i];
        const speedFraction = (b.speed ?? 0) / totalSpeed;
        const speedShare = Math.round(speedPool * speedFraction);
        const share = Math.max(floorShare, Math.min(speedShare + floorShare, remainder));
        this.setConnectionBudget(id, { current: share });
        result.set(id, share);
        remainder -= share;
      }

      // Give leftovers to the fastest task
      if (remainder > 0 && turboIds.length > 0) {
        const fastestId = turboIds.reduce((a, b) =>
          (this.connectionBudgets.get(a)?.speed ?? 0) > (this.connectionBudgets.get(b)?.speed ?? 0) ? a : b
        );
        const fastest = result.get(fastestId)!;
        result.set(fastestId, fastest + remainder);
        this.setConnectionBudget(fastestId, { current: fastest + remainder });
      }
    }

    return result;
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
