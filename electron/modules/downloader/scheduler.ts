import { EventEmitter } from "events";

export type SchedulerTask = {
  id: string;
  run: () => Promise<void>;
  onSlotOpen?: () => void;
};

export class Scheduler extends EventEmitter {
  private maxConcurrent: number;
  private active = new Set<string>();
  private queue: SchedulerTask[] = [];
  private paused = new Set<string>();

  constructor(maxConcurrent = 3) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(task: SchedulerTask): void {
    if (this.active.has(task.id) || this.queue.some(t => t.id === task.id)) return;
    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.find(t => !this.paused.has(t.id));
      if (!next) break;

      this.queue = this.queue.filter(t => t.id !== next.id);
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

    // Active tasks release their slot when the in-flight promise settles.
    if (wasQueued && !this.active.has(id)) {
      this.drain();
    }
  }

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
