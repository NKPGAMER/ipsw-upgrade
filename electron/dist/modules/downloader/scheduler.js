"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const events_1 = require("events");
class Scheduler extends events_1.EventEmitter {
    maxConcurrent;
    active = new Set();
    queue = [];
    paused = new Set();
    constructor(maxConcurrent = 3) {
        super();
        this.maxConcurrent = maxConcurrent;
    }
    enqueue(task) {
        if (this.active.has(task.id) || this.queue.some(t => t.id === task.id))
            return;
        this.queue.push(task);
        this.drain();
    }
    drain() {
        while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
            const next = this.queue.find(t => !this.paused.has(t.id));
            if (!next)
                break;
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
    pauseTask(id) {
        this.paused.add(id);
    }
    resumeTask(id) {
        this.paused.delete(id);
        this.drain();
    }
    cancelTask(id) {
        this.queue = this.queue.filter(t => t.id !== id);
        this.active.delete(id);
        this.paused.delete(id);
        this.drain();
    }
    isActive(id) {
        return this.active.has(id);
    }
    isQueued(id) {
        return this.queue.some(t => t.id === id);
    }
    getQueueLength() {
        return this.queue.length;
    }
    getActiveCount() {
        return this.active.size;
    }
}
exports.Scheduler = Scheduler;
