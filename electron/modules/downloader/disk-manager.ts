import * as fs from "fs";
import * as path from "path";
import { getDiskInfo as nativeGetDiskInfo, getAllDisk as nativeGetAllDisk, DiskType } from "../../i10r-addon";

const GB = 1024 ** 3;

export type DriveCategory = "internal_ssd" | "external_ssd" | "hdd" | "usb" | "unknown";

export interface DiskInfo {
  path: string;
  available: number;
  total: number;
  isSSd: boolean;
  isRemovable: boolean;
}

export interface DiskEnvironmentInfo {
  environment: "ssd_save" | "hdd_ssd_tmp" | "hdd_only" | "unknown";
  saveDrive: DriveEnvInfo;
  tmpDrive: DriveEnvInfo | null;
}

export interface DriveEnvInfo {
  path: string;
  mediaType: "SSD" | "HDD" | "USB" | "unknown";
}

export class DiskManager {
  private usageTracker = new Map<string, number>();

  private ssdCache = new Map<string, boolean>();
  private drivesCache: { result: DiskInfo[]; ts: number } | null = null;
  private readonly DRIVES_CACHE_TTL = 30_000;

  // ─── Public API ─────────────────────────────────────────────────────────────

  async getDiskInfo(targetPath: string): Promise<DiskInfo> {
    const resolved = path.resolve(targetPath);
    const native = nativeGetDiskInfo(resolved);
    if (!native) throw new Error(`Cannot get disk info for: ${resolved}`);
    return {
      path: native.mountPoint,
      available: native.freeSpace,
      total: native.totalSpace,
      isSSd: native.diskType === DiskType.SSD || native.diskType === DiskType.NVME,
      isRemovable: native.isRemovable,
    };
  }

  categorizeDrive(diskInfo: DiskInfo): DriveCategory {
    const native = nativeGetDiskInfo(diskInfo.path);
    if (!native) return "unknown";
    if (native.diskType === DiskType.SSD || native.diskType === DiskType.NVME) {
      return native.isRemovable ? "external_ssd" : "internal_ssd";
    }
    if (native.diskType === DiskType.USB) return "usb";
    if (native.diskType === DiskType.HDD) return "hdd";
    return "unknown";
  }

  async getDriveCategoryForPath(targetPath: string): Promise<DriveCategory> {
    const info = await this.getDiskInfo(targetPath);
    return this.categorizeDrive(info);
  }

  async detectSSD(targetPath: string): Promise<boolean> {
    const key = this.driveKey(targetPath);
    if (this.ssdCache.has(key)) return this.ssdCache.get(key)!;
    const native = nativeGetDiskInfo(targetPath);
    if (!native) return false;
    const isSSD = native.diskType === DiskType.SSD || native.diskType === DiskType.NVME;
    this.ssdCache.set(key, isSSD);
    return isSSD;
  }

  /**
   * Find an SSD to use as tmp directory when useTmp is enabled.
   * Returns the SSD mount point with most free space, or null if none found.
   */
  async findTmpDir(requiredBytes: number): Promise<string | null> {
    const drives = nativeGetAllDisk();
    let best: { path: string; available: number } | null = null;
    for (const d of drives) {
      if (d.diskType !== DiskType.SSD && d.diskType !== DiskType.NVME) continue;
      if (d.freeSpace < requiredBytes) continue;
      if (!best || d.freeSpace > best.available) {
        best = { path: d.mountPoint, available: d.freeSpace };
      }
    }
    return best?.path ?? null;
  }

  async chooseTmpDir(
    savePath: string,
    requiredBytes: number,
    _fileSize: number,
    _preferredTmpDir?: string,
  ): Promise<string | null> {
    return this.findTmpDir(requiredBytes);
  }

  async hasEnoughSpace(
    savePath: string,
    firmwareSize: number,
    bufferBytes: number = 5 * GB,
    deleteOnRun: IPSWFile[] = [],
  ): Promise<{ ok: boolean; available: number; required: number; unknown?: boolean }> {
    const freeAfterDelete = deleteOnRun.reduce((a, b) => a + b.size, 0);
    const currentUsage = Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0);
    const required = Math.max(0, firmwareSize + currentUsage + bufferBytes - freeAfterDelete);
    try {
      const info = await this.getDiskInfo(savePath);
      return { ok: info.available >= required, available: info.available, required };
    } catch {
      return { ok: false, available: -1, required, unknown: true };
    }
  }

  reserveSpace(taskId: string, bytes: number): void { this.usageTracker.set(taskId, bytes); }
  releaseSpace(taskId: string): void { this.usageTracker.delete(taskId); }
  getTotalReserved(): number { return Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0); }

  async getEnvironmentInfo(savePath: string): Promise<DiskEnvironmentInfo> {
    const saveDir = path.resolve(savePath);
    const isSSD = await this.detectSSD(saveDir);

    const saveDrive: DriveEnvInfo = {
      path: this.driveKey(saveDir),
      mediaType: isSSD ? "SSD" : "HDD",
    };

    let environment: DiskEnvironmentInfo["environment"];
    let tmpDrive: DriveEnvInfo | null = null;

    if (isSSD) {
      environment = "ssd_save";
    } else {
      const tmpDir = await this.findTmpDir(1 * GB);
      if (tmpDir !== null) {
        environment = "hdd_ssd_tmp";
        tmpDrive = { path: this.driveKey(tmpDir), mediaType: "SSD" };
      } else {
        environment = "hdd_only";
      }
    }

    return { environment, saveDrive, tmpDrive };
  }

  // ─── Driver helpers ─────────────────────────────────────────────────────────

  driveKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (process.platform === "win32") return path.parse(resolved).root.toUpperCase();
    const parts = resolved.split(path.sep).filter(Boolean);
    return path.sep + (parts[0] ?? "");
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private resolveDir(resolved: string): string {
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved : path.dirname(resolved);
    } catch { return path.dirname(resolved); }
  }
}
