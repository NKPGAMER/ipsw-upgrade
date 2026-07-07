import * as fs from "fs";
import * as path from "path";
import { DiskInfo, DiskEnvironmentInfo, DriveEnvInfo } from "./types";
import { nativeBridge, DiskType } from "./native-bridge";
import { driveKey } from "./utils";

const GB = 1024 ** 3;

export class DiskManager {
  private usageTracker = new Map<string, number>();

  // The native calls are synchronous, in-process, and cheap (no subprocess
  // spawn like the old PowerShell/fsutil implementation), so these caches
  // exist only to dedupe bursts of calls within the same tick/short window,
  // not to hide slow I/O the way they used to.
  private diskInfoCache = new Map<string, { result: DiskInfo; ts: number }>();
  private readonly DISK_INFO_CACHE_TTL = 3000;
  private drivesCache: { result: DiskInfo[]; ts: number } | null = null;
  private readonly DRIVES_CACHE_TTL = 15000;

  // ─── Public API ─────────────────────────────────────────────────────────────

  async getDiskInfo(targetPath: string): Promise<DiskInfo> {
    const resolved = path.resolve(targetPath);
    const dir = this.resolveDir(resolved);

    const cached = this.diskInfoCache.get(dir);
    if (cached && Date.now() - cached.ts < this.DISK_INFO_CACHE_TTL) return cached.result;

    const result = this.toDiskInfo(this.getNativeDiskInfoSafe(dir));
    this.diskInfoCache.set(dir, { result, ts: Date.now() });
    return result;
  }

  async detectSSD(targetPath: string): Promise<boolean> {
    const info = await this.getDiskInfo(targetPath);
    return info.isSSd;
  }

  /**
   * Choose the best SSD tmp directory.
   *
   * 1. Enumerate all drives.
   * 2. Filter to drives with available >= requiredBytes + 1 GB.
   * 3. If only HDDs qualify, return null (no tmp on HDD).
   * 4. Score SSDs (free space, non-system bonus) and return the winner.
   *
   * @param savePath  — where the final IPSW will land (used to score affinity)
   * @param requiredBytes — minimum free space needed on the drive
   * @param fileSize  — size of the tmp file about to be created
   * @param preferredTmpDir — optional user-configured tmp directory (given priority if suitable)
   */
  async chooseTmpDir(
    savePath: string,
    requiredBytes: number,
    fileSize: number,
    preferredTmpDir?: string,
  ): Promise<string | null> {
    const buffer = 1 * GB;
    const minSpace = Math.max(requiredBytes, fileSize) + buffer;

    // If user specified a preferred dir that exists and is an SSD with enough room, use it.
    if (preferredTmpDir) {
      try {
        const resolved = path.resolve(preferredTmpDir);
        if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
        const info = await this.getDiskInfo(resolved);
        if (info.isSSd && info.available >= minSpace) return resolved;
      } catch { /* try the drive-scan path */ }
    }

    // Enumerate all drives, filter, score
    const drives = await this.getAllDrives();
    const ssdCandidates = drives.filter(d => d.isSSd && d.available >= minSpace);

    if (ssdCandidates.length === 0) return null;

    const saveDriveKey = driveKey(savePath);

    const scored = ssdCandidates.map(d => ({
      dir: d.path,
      score: this.scoreDrive(d, requiredBytes, saveDriveKey),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored[0].dir;
  }

  async hasEnoughSpace(
    savePath: string,
    firmwareSize: number,
    bufferBytes: number = 5 * GB,
    deleteOnRun: IPSWFile[] = []
  ): Promise<{ ok: boolean; available: number; required: number; unknown?: boolean }> {
    let freeAfterDelete = 0;
    if (deleteOnRun) {
      freeAfterDelete = deleteOnRun.reduce((a, b) => a + b.size, 0);
    }
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

  /**
   * Analyse the disk environment for a given save path.
   * Used by the UI to show what kind of storage layout is active.
   */
  async getEnvironmentInfo(savePath: string): Promise<DiskEnvironmentInfo> {
    const saveResolved = path.resolve(savePath);
    const saveDir = this.resolveDir(saveResolved);
    const isSSD = await this.detectSSD(saveDir);

    const saveMount = driveKey(saveDir);
    const saveDrive: DriveEnvInfo = {
      path: saveMount,
      mediaType: isSSD ? "SSD" : "HDD",
    };

    let environment: DiskEnvironmentInfo["environment"];
    let tmpDrive: DriveEnvInfo | null = null;

    if (isSSD) {
      environment = "ssd_save";
    } else {
      const tmpDir = await this.chooseTmpDir(savePath, 1 * GB, 1 * GB);
      if (tmpDir !== null) {
        environment = "hdd_ssd_tmp";
        tmpDrive = { path: driveKey(tmpDir), mediaType: "SSD" };
      } else {
        environment = "hdd_only";
      }
    }

    return { environment, saveDrive, tmpDrive };
  }

  // ─── Native disk queries ────────────────────────────────────────────────────
  // Both getDiskInfo/getAllDisk are synchronous native calls (no subprocess
  // spawn), so a single call now gives us space + media type together —
  // the old implementation needed two separate PowerShell round-trips
  // (Get-PSDrive for space, Get-PhysicalDisk/fsutil for SSD/HDD) per drive.

  private getNativeDiskInfoSafe(dir: string) {
    let info: ReturnType<typeof nativeBridge.getDiskInfo> = null;
    try {
      info = nativeBridge.getDiskInfo(dir);
    } catch {
      info = null;
    }
    // native.getDiskInfo resolves to null (not a throw) when the drive
    // can't be resolved — fall back to a conservative "unknown" result
    // rather than propagating null, to match the old degrade-gracefully behaviour.
    return info ?? {
      id: "", name: "", mountPoint: dir, busType: "", filesystem: "",
      totalSpace: 0, freeSpace: 0, usedSpace: 0, temperature: 0,
      isRemovable: false, isReadonly: false, diskType: DiskType.Unknown,
    };
  }

  private toDiskInfo(native: ReturnType<typeof this.getNativeDiskInfoSafe>): DiskInfo {
    return {
      path: native.mountPoint,
      available: native.freeSpace,
      total: native.totalSpace,
      isSSd: native.diskType === DiskType.Ssd,
    };
  }

  private async getAllDrives(): Promise<DiskInfo[]> {
    if (this.drivesCache && Date.now() - this.drivesCache.ts < this.DRIVES_CACHE_TTL) {
      return this.drivesCache.result;
    }

    // One native call enumerates every drive directly — no more looping
    // C:\ through Z:\ with fs.existsSync and spawning a PowerShell process
    // per drive to fetch its space/media type.
    let native: ReturnType<typeof nativeBridge.getAllDisk>;
    try {
      native = nativeBridge.getAllDisk();
    } catch {
      native = [];
    }

    // Exclude removable (e.g. USB) and read-only volumes as tmp-dir
    // candidates — the old implementation didn't filter these out because
    // it never had the metadata to do so cheaply.
    const drives = native
      .filter(d => !d.isRemovable && !d.isReadonly)
      .map(d => this.toDiskInfo(d));

    this.drivesCache = { result: drives, ts: Date.now() };
    return drives;
  }

  /** Score an SSD drive — higher is better. */
  private scoreDrive(drive: DiskInfo, requiredBytes: number, saveDriveKey: string): number {
    let score = 0;

    // Free space headroom after required (0–50 pts, 2 pts per GB)
    const headroomGB = (drive.available - requiredBytes) / GB;
    score += Math.min(50, Math.floor(Math.max(0, headroomGB) * 2));

    // Non-system drive bonus (30 pts) — avoids competing with OS paging / I/O
    if (!drive.path.toUpperCase().startsWith("C:")) score += 30;

    // Same drive as savePath bonus (20 pts) — rename is instant on same volume
    if (driveKey(drive.path) === saveDriveKey) score += 20;

    // Larger total capacity hints at better controller / more channels (0–20 pts)
    const totalGB = drive.total / GB;
    score += Math.min(20, Math.floor(totalGB / 50));

    return score;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private resolveDir(resolved: string): string {
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved : path.dirname(resolved);
    } catch { return path.dirname(resolved); }
  }
}
