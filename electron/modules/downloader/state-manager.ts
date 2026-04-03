import * as fs from "fs";
import * as path from "path";
import { DownloadState, ChunkState } from "./types";

export class StateManager {
  private stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  }

  private statePath(id: string): string {
    return path.join(this.stateDir, `${id}.json`);
  }

  save(state: DownloadState): void {
    const updated = { ...state, updatedAt: Date.now() };
    fs.writeFileSync(this.statePath(state.id), JSON.stringify(updated, null, 2), "utf8");
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
  }

  listAll(): DownloadState[] {
    try {
      return fs
        .readdirSync(this.stateDir)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.stateDir, f), "utf8"));
          } catch {
            return null;
          }
        })
        .filter(Boolean) as DownloadState[];
    } catch {
      return [];
    }
  }

  updateChunk(id: string, chunkIndex: number, downloaded: number, completed: boolean): void {
    const state = this.load(id);
    if (!state) return;
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
  batchUpdateChunks(id: string, updates: { index: number; downloaded: number; completed: boolean }[]): void {
    const state = this.load(id);
    if (!state) return;
    for (const u of updates) {
      const chunk = state.chunks[u.index];
      if (chunk) {
        chunk.downloaded = u.downloaded;
        chunk.completed = u.completed;
      }
    }
    this.save(state);
  }

  getIncompleteChunks(id: string): ChunkState[] {
    const state = this.load(id);
    if (!state) return [];
    return state.chunks.filter(c => !c.completed);
  }
}
