/**
 * native-bridge.ts
 *
 * Thin wrapper around the Rust/napi-rs native module (see index.d.ts).
 *
 * The native module exposes disk queries as plain synchronous calls
 * (getDiskInfo / getAllDisk — no subprocess spawn, unlike the old
 * PowerShell/fsutil based implementation), and exposes hashing / file
 * transfer as fire-and-forget jobs: you call createHash()/moveFiles()/
 * copyFiles(), get an `id` back immediately, and the actual result and
 * progress arrive later through *global* callbacks (onHashProgress,
 * onHashResult, onTransferProgress, onTransferResult) that are meant to
 * be registered exactly once for the lifetime of the process.
 *
 * This class registers those global callbacks a single time and fans
 * results back out to whichever caller is waiting on that specific `id`,
 * so the rest of the codebase can just `await nativeBridge.hash(...)` /
 * `await nativeBridge.move(...)` like any other async function.
 *
 * NOTE: adjust the import path below to wherever your napi-rs binding
 * actually resolves from (e.g. a workspace package name, or a relative
 * path to the compiled addon's index.js — index.d.ts is just the type
 * declaration for it).
 */

import * as native from "../../i10r-addon"; // <-- adjust to your real native module path
import type {
  DiskInfo as NativeDiskInfo,
  HashOptions,
  HashProgress,
  HashResult,
  TransferProgress,
  TransferResult,
} from "../../i10r-addon"; // <-- same here

export { DiskType } from "../../i10r-addon"; // re-export for convenience

interface HashJob {
  onProgress?: (p: HashProgress) => void;
  resolve: (r: HashResult) => void;
  reject: (e: Error) => void;
}

interface TransferJob {
  onProgress?: (p: TransferProgress) => void;
  resolve: (r: TransferResult) => void;
  reject: (e: Error) => void;
}

class NativeBridge {
  private hashJobs = new Map<string, HashJob>();
  private transferJobs = new Map<string, TransferJob>();
  private initialized = false;

  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    native.onHashProgress((p: HashProgress) => {
      this.hashJobs.get(p.id)?.onProgress?.(p);
    });

    native.onHashResult((r: HashResult) => {
      const job = this.hashJobs.get(r.id);
      if (!job) return; // already settled (e.g. aborted) — ignore late result
      this.hashJobs.delete(r.id);
      r.error ? job.reject(new Error(r.error)) : job.resolve(r);
    });

    native.onTransferProgress((p: TransferProgress) => {
      this.transferJobs.get(p.id)?.onProgress?.(p);
    });

    native.onTransferResult((r: TransferResult) => {
      const job = this.transferJobs.get(r.id);
      if (!job) return;
      this.transferJobs.delete(r.id);
      r.success ? job.resolve(r) : job.reject(new Error(r.error ?? "Native transfer failed"));
    });
  }

  // ─── Hashing ────────────────────────────────────────────────────────────

  /**
   * Compute (and optionally match) a file hash using the Rust hasher —
   * streams the file on the native side, avoiding the JS event-loop
   * overhead of Node's crypto + fs.createReadStream pipeline.
   *
   * Caveat: the native module has no cancelHash API. If `signal` aborts,
   * this promise rejects immediately and stops listening, but the Rust
   * job itself keeps running to completion in the background (harmless,
   * just wasted CPU/IO — there's currently no way to stop it early).
   */
  hash(
    filePath: string,
    options: HashOptions,
    onProgress?: (p: HashProgress) => void,
    signal?: AbortSignal,
  ): Promise<HashResult> {
    this.ensureInit();
    return new Promise<HashResult>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("ABORTED"));

      const id = native.createHash(filePath, options);

      const onAbort = () => {
        this.hashJobs.delete(id);
        reject(new Error("ABORTED"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.hashJobs.set(id, {
        onProgress,
        resolve: (r) => { signal?.removeEventListener("abort", onAbort); resolve(r); },
        reject: (e) => { signal?.removeEventListener("abort", onAbort); reject(e); },
      });
    });
  }

  // ─── File transfer ──────────────────────────────────────────────────────

  /** Move file(s)/directory via the native (kernel-level) transfer, with progress. */
  move(
    from: string | string[],
    to: string,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<TransferResult> {
    this.ensureInit();
    return new Promise<TransferResult>((resolve, reject) => {
      const id = native.moveFiles(from, to);
      this.transferJobs.set(id, { onProgress, resolve, reject });
    });
  }

  /** Copy file(s)/directory via the native (kernel-level) transfer, with progress. */
  copy(
    from: string | string[],
    to: string,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<TransferResult> {
    this.ensureInit();
    return new Promise<TransferResult>((resolve, reject) => {
      const id = native.copyFiles(from, to);
      this.transferJobs.set(id, { onProgress, resolve, reject });
    });
  }

  // ─── Disk info ──────────────────────────────────────────────────────────
  // Both are plain synchronous native calls — no subprocess, no PowerShell.
  // getDiskInfo returns null (not a throw) when the drive can't be found.

  getDiskInfo(targetPath: string): NativeDiskInfo | null {
    return native.getDiskInfo(targetPath);
  }

  getAllDisk(): NativeDiskInfo[] {
    return native.getAllDisk();
  }
}

export const nativeBridge = new NativeBridge();
