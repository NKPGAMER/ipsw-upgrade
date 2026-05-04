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
const fs_utils_1 = require("../../utils/fs-utils");
class StateManager {
    stateDir;
    constructor(stateDir) {
        this.stateDir = stateDir;
        (0, fs_utils_1.ensureDir)(this.stateDir);
    }
    statePath(id) {
        return path.join(this.stateDir, `${id}.json`);
    }
    save(state) {
        const updated = { ...state, updatedAt: Date.now() };
        fs.writeFileSync(this.statePath(state.id), JSON.stringify(updated, null, 2), "utf8");
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
    updateChunk(id, chunkIndex, downloaded, completed) {
        const state = this.load(id);
        if (!state)
            return;
        const chunk = state.chunks[chunkIndex];
        if (chunk) {
            chunk.downloaded = downloaded;
            chunk.completed = completed;
        }
        this.save(state);
    }
    /**
     * Batch-update chunks — use this for performance (group writes)
     */
    batchUpdateChunks(id, updates) {
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
        this.save(state);
    }
    getIncompleteChunks(id) {
        const state = this.load(id);
        if (!state)
            return [];
        return state.chunks.filter(c => !c.completed);
    }
}
exports.StateManager = StateManager;
