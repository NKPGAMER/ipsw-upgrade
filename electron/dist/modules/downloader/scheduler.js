"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const events_1 = require("events");
class Scheduler extends events_1.EventEmitter {
    maxConcurrent;
    active = new Set();
    queue = [];
    paused = new Set();
    // ── Turbo mode state ─────────────────────────────────────────────────────
    turboMode = false;
    env = "ssd_save";
    maxTurbo = 0;
    maxNormal = 0;
    activeTurbo = new Set();
    activeNormal = new Set();
    activeRunGens = new Map();
    constructor(maxConcurrent = 3) {
        super();
        this.maxConcurrent = maxConcurrent;
    }
    // ── Turbo mode configuration ─────────────────────────────────────────────
    setTurboMode(enabled, environment) {
        this.turboMode = enabled;
        this.env = environment;
        if (enabled) {
            switch (environment) {
                case "ssd_save":
                    this.maxTurbo = 3;
                    this.maxNormal = 2;
                    break;
                case "hdd_ssd_tmp":
                    this.maxTurbo = 1;
                    this.maxNormal = 2;
                    break;
                case "hdd_only":
                    this.maxTurbo = 1;
                    this.maxNormal = 1;
                    break;
            }
        }
        else {
            this.maxTurbo = 0;
            this.maxNormal = 0;
        }
        // Kick drain to rebalance slots after limits change
        this.drain();
    }
    setEnvironment(env) {
        this.env = env;
        if (this.turboMode)
            this.setTurboMode(true, env);
    }
    // ── Public API ───────────────────────────────────────────────────────────
    enqueue(task) {
        if (this.active.has(task.id) || this.queue.some(t => t.id === task.id))
            return;
        this.queue.push(task);
        this.drain();
    }
    drain() {
        if (this.turboMode) {
            this.drainTurbo();
        }
        else {
            this.drainLegacy();
        }
    }
    drainTurbo() {
        // Turbo only pulls from Normal (promotion), Normal only pulls from Queue.
        // Fill normal slots from queue — turbo slots are filled exclusively via
        // promoteNormalToTurbo() or tryFillTurboSlotFromQueue() (for the edge case
        // where all normal slots are full and their tasks are "moving", not "downloading").
        while (this.activeNormal.size < this.maxNormal && this.queue.length > 0) {
            const idx = this.queue.findIndex(t => !this.paused.has(t.id));
            if (idx === -1)
                break;
            const next = this.queue.splice(idx, 1)[0];
            this.activeNormal.add(next.id);
            this.active.add(next.id);
            next.onSlotOpen?.("normal");
            this.emit("started", next.id);
            const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
            this.activeRunGens.set(next.id, gen);
            next.run().finally(() => {
                if (this.activeRunGens.get(next.id) !== gen)
                    return;
                this.activeNormal.delete(next.id);
                this.active.delete(next.id);
                this.activeRunGens.delete(next.id);
                this.emit("slot_open", next.id, "normal");
                this.drain();
            });
        }
    }
    /**
     * Edge case: all normal slots are full but their tasks are in "move" status
     * (not "downloading"). In this case, promote can't pull from normal, so we
     * assign a turbo slot directly from the queue.
     */
    tryFillTurboSlotFromQueue() {
        if (!this.turboMode)
            return false;
        if (this.activeTurbo.size >= this.maxTurbo)
            return false;
        const idx = this.queue.findIndex(t => !this.paused.has(t.id));
        if (idx === -1)
            return false;
        const next = this.queue.splice(idx, 1)[0];
        this.activeTurbo.add(next.id);
        this.active.add(next.id);
        next.onSlotOpen?.("turbo");
        this.emit("started", next.id);
        const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
        this.activeRunGens.set(next.id, gen);
        next.run().finally(() => {
            if (this.activeRunGens.get(next.id) !== gen)
                return;
            this.activeTurbo.delete(next.id);
            this.active.delete(next.id);
            this.activeRunGens.delete(next.id);
            this.emit("slot_open", next.id, "turbo");
            this.drain();
        });
        return true;
    }
    drainLegacy() {
        while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
            const idx = this.queue.findIndex(t => !this.paused.has(t.id));
            if (idx === -1)
                break;
            const next = this.queue.splice(idx, 1)[0];
            this.active.add(next.id);
            this.emit("started", next.id);
            const gen = (this.activeRunGens.get(next.id) ?? 0) + 1;
            this.activeRunGens.set(next.id, gen);
            next.run().finally(() => {
                if (this.activeRunGens.get(next.id) !== gen)
                    return;
                this.active.delete(next.id);
                this.activeRunGens.delete(next.id);
                this.emit("slot_open", next.id);
                this.drain();
            });
        }
    }
    pauseTask(id) {
        this.paused.add(id);
        const wasTurbo = this.activeTurbo.delete(id);
        const wasNormal = this.activeNormal.delete(id);
        this.active.delete(id);
        // Invalidate old promise's finally() so it won't double-free the slot
        const gen = (this.activeRunGens.get(id) ?? 0) + 1;
        this.activeRunGens.set(id, gen);
        if (wasTurbo) {
            this.emit("slot_open", id, "turbo");
        }
        else if (wasNormal) {
            this.emit("slot_open", id, "normal");
        }
        this.drain();
    }
    resumeTask(id) {
        this.paused.delete(id);
        this.drain();
    }
    cancelTask(id) {
        this.queue = this.queue.filter(t => t.id !== id);
        this.paused.delete(id);
        const wasTurbo = this.activeTurbo.delete(id);
        const wasNormal = this.activeNormal.delete(id);
        this.active.delete(id);
        // Invalidate old promise's finally()
        const gen = (this.activeRunGens.get(id) ?? 0) + 1;
        this.activeRunGens.set(id, gen);
        if (wasTurbo || wasNormal) {
            this.drain();
        }
    }
    // ── Promotion ────────────────────────────────────────────────────────────
    promoteNormalToTurbo(id) {
        if (!this.activeNormal.has(id))
            return false;
        if (this.activeTurbo.size >= this.maxTurbo)
            return false;
        this.activeNormal.delete(id);
        this.activeTurbo.add(id);
        this.emit("promoted", id);
        return true;
    }
    hasFreeTurboSlot() {
        return this.turboMode && this.activeTurbo.size < this.maxTurbo;
    }
    hasFreeNormalSlot() {
        return this.turboMode && this.activeNormal.size < this.maxNormal;
    }
    getMaxNormal() {
        return this.turboMode ? this.maxNormal : this.maxConcurrent;
    }
    /** All normal slots are occupied (regardless of task state) */
    areAllNormalSlotsFull() {
        if (!this.turboMode)
            return false;
        return this.activeNormal.size >= this.maxNormal;
    }
    getActiveNormalDownloadingIds() {
        return Array.from(this.activeNormal);
    }
    getActiveTurboCount() {
        return this.activeTurbo.size;
    }
    getActiveNormalCount() {
        return this.activeNormal.size;
    }
    // ── Read-only queries ────────────────────────────────────────────────────
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
