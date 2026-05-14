"use strict";
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
exports.StateManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class StateManager {
    stateDir;
    lock = Promise.resolve();
    constructor(stateDir) {
        this.stateDir = stateDir;
        fs.mkdirSync(this.stateDir, { recursive: true });
    }
    statePath(id) {
        return path.join(this.stateDir, `${id}.json`);
    }
    withLock(fn) {
        return new Promise((resolve, reject) => {
            this.lock = this.lock.then(() => {
                try {
                    resolve(fn());
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }
    save(state) {
        return this.withLock(() => {
            const updated = { ...state, updatedAt: Date.now() };
            const target = this.statePath(state.id);
            const dir = path.dirname(target);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(target, JSON.stringify(updated, null, 2), "utf8");
        });
    }
    load(id) {
        const p = this.statePath(id);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, "utf8"));
        }
        catch {
            return null;
        }
    }
    delete(id) {
        const p = this.statePath(id);
        if (fs.existsSync(p))
            fs.unlinkSync(p);
    }
    listAll() {
        try {
            return fs
                .readdirSync(this.stateDir)
                .filter(f => f.endsWith(".json"))
                .map(f => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(this.stateDir, f), "utf8"));
                }
                catch {
                    return null;
                }
            })
                .filter(Boolean);
        }
        catch {
            return [];
        }
    }
    async updateChunk(id, chunkIndex, downloaded, completed) {
        return this.withLock(() => {
            const state = this.load(id);
            if (!state)
                return;
            const chunk = state.chunks[chunkIndex];
            if (chunk) {
                chunk.downloaded = downloaded;
                chunk.completed = completed;
                this.saveSync(state);
            }
        });
    }
    /**
     * Batch-update chunks — use this for performance (group writes)
     */
    async batchUpdateChunks(id, updates) {
        return this.withLock(() => {
            const state = this.load(id);
            if (!state)
                return;
            for (const u of updates) {
                const chunk = state.chunks[u.index];
                if (chunk) {
                    chunk.downloaded = u.downloaded;
                    chunk.completed = u.completed;
                }
            }
            this.saveSync(state);
        });
    }
    getIncompleteChunks(id) {
        const state = this.load(id);
        if (!state)
            return [];
        return state.chunks.filter(c => !c.completed);
    }
    async addMovedChunk(id, chunkIndex) {
        return this.withLock(() => {
            const state = this.load(id);
            if (!state)
                return;
            if (!state.movedChunks)
                state.movedChunks = [];
            if (!state.movedChunks.includes(chunkIndex)) {
                state.movedChunks.push(chunkIndex);
                this.saveSync(state);
            }
        });
    }
    async setMovedChunks(id, indices) {
        return this.withLock(() => {
            const state = this.load(id);
            if (!state)
                return;
            state.movedChunks = indices;
            this.saveSync(state);
        });
    }
    saveSync(state) {
        const updated = { ...state, updatedAt: Date.now() };
        const target = this.statePath(state.id);
        const dir = path.dirname(target);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, JSON.stringify(updated, null, 2), "utf8");
    }
}
exports.StateManager = StateManager;
