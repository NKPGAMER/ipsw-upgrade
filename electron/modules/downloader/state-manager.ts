import * as fs from "fs";
import * as path from "path";
import { DownloadState, ChunkState } from "./types";

export interface SaveResult {
  lastCheckpoint: number;
  lastWriteTime: number;
}

export class StateManager {
  private stateDir: string;
  private lock: Promise<void> = Promise.resolve();

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private statePath(id: string): string {
    return path.join(this.stateDir, `${id}.json`);
  }

  private tempPath(id: string): string {
    return path.join(this.stateDir, `${id}.json.i10r`);
  }

  private withLock<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.lock = this.lock.then(() => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  save(state: DownloadState): Promise<void> {
    return this.withLock(() => {
      this.saveSync(state);
    });
  }

  /**
   * Atomic save — writes to .json.i10r first, then renames to .json.
   * Returns timing info for checkpoint tracking.
   */
  saveAtomic(state: DownloadState): SaveResult {
    const start = Date.now();
    this.saveSync(state);
    return { lastCheckpoint: start, lastWriteTime: Date.now() - start };
  }

  load(id: string): DownloadState | null {
    const p = this.statePath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }

  delete(id: string): void {
    const p = this.statePath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    // Also clean up any leftover temp file
    const tmp = this.tempPath(id);
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  async listAll(): Promise<DownloadState[]> {
    try {
      const files = await fs.promises.readdir(this.stateDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));
      const results: DownloadState[] = [];

      for (const f of jsonFiles) {
        try {
          const content = await fs.promises.readFile(path.join(this.stateDir, f), "utf8");
          const state = JSON.parse(content);
          if (state) results.push(state);
        } catch {
          // Skip corrupted state files
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  async updateChunk(id: string, chunkIndex: number, downloaded: number, completed: boolean): Promise<void> {
    return this.withLock(() => {
      const state = this.load(id);
      if (!state) return;
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
  async batchUpdateChunks(id: string, updates: { index: number; downloaded: number; completed: boolean }[]): Promise<void> {
    return this.withLock(() => {
      const state = this.load(id);
      if (!state) return;
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

  getIncompleteChunks(id: string): ChunkState[] {
    const state = this.load(id);
    if (!state) return [];
    return state.chunks.filter(c => !c.completed);
  }

  async addMovedChunk(id: string, chunkIndex: number): Promise<void> {
    return this.withLock(() => {
      const state = this.load(id);
      if (!state) return;
      if (!state.movedChunks) state.movedChunks = [];
      // Use a Set for O(1) lookup, then convert back to sorted array
      const movedSet = new Set(state.movedChunks);
      if (!movedSet.has(chunkIndex)) {
        movedSet.add(chunkIndex);
        state.movedChunks = Array.from(movedSet).sort((a, b) => a - b);
        this.saveSync(state);
      }
    });
  }

  async setMovedChunks(id: string, indices: number[]): Promise<void> {
    return this.withLock(() => {
      const state = this.load(id);
      if (!state) return;
      state.movedChunks = indices;
      this.saveSync(state);
    });
  }

  /**
   * Atomic write: .json.i10r → rename → .json
   * If the process crashes mid-write, only the .json.i10r temp file is
   * corrupted; the real .json stays intact from the previous checkpoint.
   */
  private saveSync(state: DownloadState): void {
    const updated = { ...state, updatedAt: Date.now() };
    const target = this.statePath(state.id);
    const tmp = this.tempPath(state.id);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), "utf8");
    fs.renameSync(tmp, target);
  }
}
