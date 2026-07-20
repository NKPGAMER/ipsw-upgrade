import { EventEmitter } from "events";
import type { DriveCategory } from "./disk-manager";

export type { DriveCategory };

export interface SchedulerTask {
  id: string;
  driveCategory: DriveCategory;
  connectionsNeeded: number;
  run: () => Promise<void>;
}

interface SchedulerConfig {
  maxSsdTasks: number;
  maxHddTasks: number;
  maxExternalSsdTasks: number;
  maxUsbTasks: number;
  maxConnections: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxSsdTasks: 3,
  maxHddTasks: 1,
  maxExternalSsdTasks: 2,
  maxUsbTasks: 1,
  maxConnections: 0,
};

export class Scheduler extends EventEmitter {
  private config: SchedulerConfig;
  private queue: SchedulerTask[] = [];
  private paused = new Set<string>();

  private active = new Map<string, { task: SchedulerTask; gen: number }>();
  private activeByCategory = new Map<DriveCategory, Set<string>>();
  private runGens = new Map<string, number>();

  private connectionsUsed = 0;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  updateConfig(partial: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...partial };
    this.drain();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  enqueue(task: SchedulerTask): void {
    if (this.active.has(task.id) || this.queue.some(t => t.id === task.id)) return;
    this.queue.push(task);
    this.drain();
  }

  drain(): void {
    this.drainLoop();
  }

  private drainLoop(): void {
    let started = true;
    while (started) {
      started = false;
      for (let i = 0; i < this.queue.length; i++) {
        const task = this.queue[i];
        if (this.paused.has(task.id)) continue;

        if (!this.hasDiskSlot(task)) continue;
        if (!this.acquireConnections(task.connectionsNeeded)) continue;

        this.queue.splice(i, 1);
        this.startTask(task);
        started = true;
        break;
      }
    }
  }

  pauseTask(id: string): void {
    this.paused.add(id);
    const entry = this.active.get(id);
    if (entry) {
      const gen = (this.runGens.get(id) ?? 0) + 1;
      this.runGens.set(id, gen);
      this.releaseConnections(entry.task.connectionsNeeded);
      this.removeFromCategory(entry.task);
      this.active.delete(id);
      this.queue.unshift(entry.task);
      this.drain();
    }
  }

  resumeTask(id: string): void {
    this.paused.delete(id);
    this.drain();
  }

  cancelTask(id: string): void {
    this.queue = this.queue.filter(t => t.id !== id);
    this.paused.delete(id);
    const entry = this.active.get(id);
    if (entry) {
      const gen = (this.runGens.get(id) ?? 0) + 1;
      this.runGens.set(id, gen);
      this.releaseConnections(entry.task.connectionsNeeded);
      this.removeFromCategory(entry.task);
      this.active.delete(id);
      this.drain();
    }
  }

  // ─── Read-only queries ────────────────────────────────────────────────────

  isActive(id: string): boolean { return this.active.has(id); }
  isQueued(id: string): boolean { return this.queue.some(t => t.id === id); }
  getQueueLength(): number { return this.queue.length; }
  getActiveCount(): number { return this.active.size; }
  getActiveCountByCategory(cat: DriveCategory): number { return this.activeByCategory.get(cat)?.size ?? 0; }
  getConnectionsUsed(): number { return this.connectionsUsed; }
  getMaxConnections(): number { return this.config.maxConnections; }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private hasDiskSlot(task: SchedulerTask): boolean {
    const max = this.getMaxForCategory(task.driveCategory);
    const current = this.activeByCategory.get(task.driveCategory)?.size ?? 0;
    return current < max;
  }

  private getMaxForCategory(cat: DriveCategory): number {
    switch (cat) {
      case "internal_ssd": return this.config.maxSsdTasks;
      case "external_ssd": return this.config.maxExternalSsdTasks;
      case "hdd": return this.config.maxHddTasks;
      case "usb": return this.config.maxUsbTasks;
      default: return this.config.maxHddTasks;
    }
  }

  private acquireConnections(n: number): boolean {
    if (this.config.maxConnections === 0) return true;
    if (this.connectionsUsed + n <= this.config.maxConnections) {
      this.connectionsUsed += n;
      return true;
    }
    return false;
  }

  private releaseConnections(n: number): void {
    this.connectionsUsed = Math.max(0, this.connectionsUsed - n);
  }

  private startTask(task: SchedulerTask): void {
    this.active.set(task.id, { task, gen: 1 });
    let set = this.activeByCategory.get(task.driveCategory);
    if (!set) { set = new Set(); this.activeByCategory.set(task.driveCategory, set); }
    set.add(task.id);

    const gen = (this.runGens.get(task.id) ?? 0) + 1;
    this.runGens.set(task.id, gen);
    this.emit("started", task.id);

    task.run().finally(() => {
      if (this.runGens.get(task.id) !== gen) return;
      this.releaseConnections(task.connectionsNeeded);
      this.removeFromCategory(task);
      this.active.delete(task.id);
      this.runGens.delete(task.id);
      this.emit("slot_open", task.id);
      this.drain();
    });
  }

  private removeFromCategory(task: SchedulerTask): void {
    const set = this.activeByCategory.get(task.driveCategory);
    set?.delete(task.id);
    if (set?.size === 0) this.activeByCategory.delete(task.driveCategory);
  }
}
