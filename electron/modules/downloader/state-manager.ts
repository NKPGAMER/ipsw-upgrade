import * as fs from "fs";
import * as path from "path";
import { DownloadState } from "@custom-type/downloader";

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

  private i10rPath(id: string): string {
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

  saveAtomic(state: DownloadState): { lastCheckpoint: number; lastWriteTime: number } {
    const start = Date.now();
    this.saveSync(state);
    const lastWriteTime = Date.now() - start;
    return { lastCheckpoint: start, lastWriteTime };
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

  private saveSync(state: DownloadState): void {
    const updated = { ...state, updatedAt: Date.now() };
    const target = this.statePath(state.id);
    const i10r = this.i10rPath(state.id);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(i10r, JSON.stringify(updated, null, 2), "utf8");
    fs.renameSync(i10r, target);
  }
}
