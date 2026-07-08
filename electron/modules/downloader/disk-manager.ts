import * as fs from "fs";
import * as path from "path";
import { getDiskInfo as nativeGetDiskInfo, getAllDisk as nativeGetAllDisk } from "../../i10r-addon";
import { DiskInfo, DiskEnvironmentInfo, DriveEnvInfo } from "./types";

const GB = 1024 ** 3;

export class DiskManager {
  private usageTracker = new Map<string, number>();

  private ssdCache = new Map<string, boolean>();
  private drivesCache: { result: DiskInfo[]; ts: number } | null = null;
  private readonly DRIVES_CACHE_TTL = 30000;

  // ─── Public API ─────────────────────────────────────────────────────────────

  async getDiskInfo(targetPath: string): Promise<DiskInfo> {
    const resolved = path.resolve(targetPath);
    const native = nativeGetDiskInfo(resolved);
    if (!native) throw new Error(`Cannot get disk info for: ${resolved}`);
    return {
      path: native.mountPoint,
      available: native.freeSpace,
      total: native.totalSpace,
      isSSd: native.diskType === "Ssd",
    };
  }

  async detectSSD(targetPath: string): Promise<boolean> {
    const key = this.driveKey(targetPath);
    if (this.ssdCache.has(key)) return this.ssdCache.get(key)!;
    const native = nativeGetDiskInfo(targetPath);
    if (!native) return false;
    const isSSD = native.diskType === "Ssd";
    this.ssdCache.set(key, isSSD);
    return isSSD;
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

    if (preferredTmpDir) {
      try {
        const resolved = path.resolve(preferredTmpDir);
        if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
        const info = await this.getDiskInfo(resolved);
        if (info.isSSd && info.available >= minSpace) return resolved;
      } catch { /* try the drive-scan path */ }
    }

    const drives = this.getAllDrives();
    const ssdCandidates = drives.filter(d => d.isSSd && d.available >= minSpace);

    if (ssdCandidates.length === 0) return null;

    const saveDriveKey = this.driveKey(savePath);

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

    const saveMount = this.driveKey(saveDir);
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
        tmpDrive = { path: this.driveKey(tmpDir), mediaType: "SSD" };
      } else {
        environment = "hdd_only";
      }
    }

    return { environment, saveDrive, tmpDrive };
  }

  // ─── Drive enumeration ──────────────────────────────────────────────────────

  private getAllDrives(): DiskInfo[] {
    if (this.drivesCache && Date.now() - this.drivesCache.ts < this.DRIVES_CACHE_TTL) {
      return this.drivesCache.result;
    }

    const native = nativeGetAllDisk();
    const drives: DiskInfo[] = native.map(d => ({
      path: d.mountPoint,
      available: d.freeSpace,
      total: d.totalSpace,
      isSSd: d.diskType === "Ssd",
    }));

    this.drivesCache = { result: drives, ts: Date.now() };
    return drives;
  }

  /** Score an SSD drive — higher is better. */
  private scoreDrive(drive: DiskInfo, requiredBytes: number, saveDriveKey: string): number {
    let score = 0;

    const headroomGB = (drive.available - requiredBytes) / GB;
    score += Math.min(50, Math.floor(Math.max(0, headroomGB) * 2));

    if (!drive.path.toUpperCase().startsWith("C:")) score += 30;

    if (this.driveKey(drive.path) === saveDriveKey) score += 20;

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

  private driveKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (process.platform === "win32") return path.parse(resolved).root.toUpperCase();
    const parts = resolved.split(path.sep).filter(Boolean);
    return path.sep + (parts[0] ?? "");
  }
}
