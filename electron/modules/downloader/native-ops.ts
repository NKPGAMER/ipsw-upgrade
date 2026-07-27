import {
  createHash as nativeCreateHash,
  moveFile as nativeMoveFile,
  copyFile as nativeCopyFile,
  cancelHash,
  cancelTransfer,
  pauseHash,
  pauseTransfer,
  resumeHash,
  resumeTransfer,
  onHashEvent,
  onTransferEvent,
  HashType,
} from "../../i10r-addon";

export { HashType };

interface HashPending {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  onProgress?: (info: HashProgress) => void;
}

interface TransferPending {
  resolve: () => void;
  reject: (err: Error) => void;
  onProgress?: (info: TransferProgress) => void;
}

interface HashProgress {
  pct: number;
  speed: number;
  eta: number;
}

interface TransferProgress {
  pct: number;
  speed: number;
  eta: number;
  transferredBytes: number;
  totalBytes: number;
}

export interface HashOp {
  id: string;
  promise: Promise<string>;
}

let initialized = false;
const hashPending = new Map<string, HashPending>();
const transferPending = new Map<string, TransferPending>();

const HASH_TIMEOUT_MS = 7200_000;     // 2 hours
const TRANSFER_TIMEOUT_MS = 600_000;  // 10 minutes

export function initNativeOps(): void {
  if (initialized) return;
  initialized = true;

  onHashEvent((json: string) => {
    const evt = JSON.parse(json);
    const p = hashPending.get(evt.id);
    if (!p) return;
    p.onProgress?.({
      pct: evt.progress,
      speed: evt.speed,
      eta: evt.eta,
    });
    if (evt.hash) {
      hashPending.delete(evt.id);
      p.resolve(evt.hash);
    }
  });

  onTransferEvent((json: string) => {
    const evt = JSON.parse(json);
    const p = transferPending.get(evt.id);
    if (!p) return;

    const e = String(evt.event);
    if (e === "Progress" || e === "0") {
      p.onProgress?.({
        pct: evt.progress ?? 0,
        speed: evt.speed ?? 0,
        eta: evt.eta ?? 0,
        transferredBytes: evt.transferredBytes ?? 0,
        totalBytes: evt.totalBytes ?? 0,
      });
    } else if (e === "Completed" || e === "1") {
      transferPending.delete(evt.id);
      p.resolve();
    } else if (e === "Error" || e === "2") {
      transferPending.delete(evt.id);
      p.reject(new Error(evt.error ?? "Transfer failed"));
    } else if (e === "Canceled" || e === "3") {
      transferPending.delete(evt.id);
      p.reject(new Error("Transfer cancelled"));
    }
  });
}

export function startHash(
  filePath: string,
  hashType: HashType,
  onProgress?: (info: { pct: number; speed: number; eta: number }) => void,
): HashOp {
  const id = nativeCreateHash(filePath, hashType);
  const promise = new Promise<string>((resolve, reject) => {
    hashPending.set(id, { resolve, reject, onProgress });
    setTimeout(() => {
      if (hashPending.has(id)) {
        cancelHash(id);
        hashPending.delete(id);
        reject(new Error(`Hash operation timed out after ${HASH_TIMEOUT_MS}ms`));
      }
    }, HASH_TIMEOUT_MS);
  });
  return { id, promise };
}

export function startMove(
  from: string,
  to: string,
  onProgress?: (info: { pct: number; speed: number; eta: number; transferredBytes: number; totalBytes: number }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = nativeMoveFile(from, to);
    transferPending.set(id, { resolve, reject, onProgress });
    setTimeout(() => {
      if (transferPending.has(id)) {
        cancelTransfer(id);
        transferPending.delete(id);
        reject(new Error(`Move operation timed out after ${TRANSFER_TIMEOUT_MS}ms`));
      }
    }, TRANSFER_TIMEOUT_MS);
  });
}

export function startCopy(
  filePath: string,
  toFolder: string,
  onProgress?: (info: { pct: number; speed: number; eta: number; transferredBytes: number; totalBytes: number }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = nativeCopyFile(filePath, toFolder);
    transferPending.set(id, { resolve, reject, onProgress });
    setTimeout(() => {
      if (transferPending.has(id)) {
        cancelTransfer(id);
        transferPending.delete(id);
        reject(new Error(`Copy operation timed out after ${TRANSFER_TIMEOUT_MS}ms`));
      }
    }, TRANSFER_TIMEOUT_MS);
  });
}

export { cancelHash as cancelNativeHash };
export { cancelTransfer as cancelNativeTransfer };
export { pauseHash as pauseNativeHash };
export { pauseTransfer as pauseNativeTransfer };
export { resumeHash as resumeNativeHash };
export { resumeTransfer as resumeNativeTransfer };
