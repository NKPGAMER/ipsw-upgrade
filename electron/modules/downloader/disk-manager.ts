import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { DiskInfo } from "./types";

const execFileAsync = promisify(execFile);

export class DiskManager {
  private usageTracker = new Map<string, number>();

  // Cache SSD detection per drive — only needs to run once per session
  private ssdCache = new Map<string, boolean>();
  // Cache disk space per dir — valid for 5 seconds
  private spaceCache = new Map<string, { result: { available: number; total: number }; ts: number }>();
  private readonly SPACE_CACHE_TTL = 5000;

  // ─── Public API ─────────────────────────────────────────────────────────────

  async getDiskInfo(targetPath: string): Promise<DiskInfo> {
    const resolved = path.resolve(targetPath);
    const dir = this.resolveDir(resolved);
    const [stats, isSSd] = await Promise.all([
      this.getStatfs(dir),
      this.detectSSD(dir),
    ]);
    return { path: dir, available: stats.available, total: stats.total, isSSd };
  }

  async detectSSD(targetPath: string): Promise<boolean> {
    const key = this.driveKey(targetPath);
    if (this.ssdCache.has(key)) return this.ssdCache.get(key)!;
    const result = await this.detectSSDUncached(targetPath);
    this.ssdCache.set(key, result);
    return result;
  }

  async chooseTmpDir(savePath: string, requiredBytes: number, preferredTmpDir?: string): Promise<string> {
    const candidates: string[] = [];
    if (preferredTmpDir) candidates.push(preferredTmpDir);
    candidates.push(process.env.TMPDIR || process.env.TEMP || "/tmp");
    candidates.push(path.dirname(path.resolve(savePath)));

    const probes = await Promise.all(
      candidates.map(async (dir) => {
        try {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const info = await this.getDiskInfo(dir);
          return { dir, info };
        } catch { return null; }
      })
    );

    for (const p of probes) {
      if (p && p.info.isSSd && p.info.available >= requiredBytes + 1 * 1024 ** 3) return p.dir;
    }
    for (const p of probes) {
      if (p && p.info.available >= requiredBytes) return p.dir;
    }
    return path.dirname(path.resolve(savePath));
  }

  async hasEnoughSpace(
    savePath: string,
    firmwareSize: number,
    bufferBytes: number = 5 * 1024 ** 3
  ): Promise<{ ok: boolean; available: number; required: number }> {
    const currentUsage = Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0);
    const required = firmwareSize + currentUsage + bufferBytes;
    const info = await this.getDiskInfo(savePath);
    return { ok: info.available >= required, available: info.available, required };
  }

  reserveSpace(taskId: string, bytes: number): void { this.usageTracker.set(taskId, bytes); }
  releaseSpace(taskId: string): void { this.usageTracker.delete(taskId); }
  getTotalReserved(): number { return Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0); }

  // ─── Async disk space ────────────────────────────────────────────────────────

  private async getStatfs(dir: string): Promise<{ available: number; total: number }> {
    const cached = this.spaceCache.get(dir);
    if (cached && Date.now() - cached.ts < this.SPACE_CACHE_TTL) return cached.result;
    const result = await this.getStatfsUncached(dir);
    this.spaceCache.set(dir, { result, ts: Date.now() });
    return result;
  }

  private async getStatfsUncached(dir: string): Promise<{ available: number; total: number }> {
    // Try native fs.statfs first (Node 19+, truly non-blocking)
    try {
      const s = await (fs.promises as any).statfs(dir);
      return { available: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch { /* older Node — fall back to subprocess */ }

    try {
      if (process.platform === "win32") return await this.getStatfsWindows(dir);
      return await this.getStatfsUnix(dir);
    } catch {
      return { available: 50 * 1024 ** 3, total: 100 * 1024 ** 3 };
    }
  }

  private async getStatfsWindows(dir: string): Promise<{ available: number; total: number }> {
    const driveLetter = path.parse(dir).root.replace(/\\/g, "").replace(":", "");
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command",
       `$d=Get-PSDrive ${driveLetter};Write-Output "$($d.Free) $($d.Used)"`],
      { timeout: 8000 }
    );
    const [freeStr, usedStr] = stdout.trim().split(" ");
    const free = parseInt(freeStr);
    const used = parseInt(usedStr);
    if (!isNaN(free) && !isNaN(used)) return { available: free, total: free + used };
    throw new Error("PowerShell parse failed");
  }

  private async getStatfsUnix(dir: string): Promise<{ available: number; total: number }> {
    const { stdout } = await execFileAsync("df", ["-k", dir], { timeout: 5000 });
    const lines = stdout.trim().split("\n");
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    return { total: parseInt(parts[1]) * 1024, available: parseInt(parts[3]) * 1024 };
  }

  // ─── Async SSD detection ─────────────────────────────────────────────────────

  private async detectSSDUncached(targetPath: string): Promise<boolean> {
    try {
      if (process.platform === "linux") return await this.detectSSDLinux(targetPath);
      if (process.platform === "darwin") return await this.detectSSDMac();
      if (process.platform === "win32") return await this.detectSSDWindows(targetPath);
    } catch { /* fall through */ }
    return false;
  }

  private async detectSSDLinux(targetPath: string): Promise<boolean> {
    const { stdout } = await execFileAsync("df", [targetPath], { timeout: 3000 });
    const device = stdout.trim().split("\n")[1]?.split(/\s+/)[0];
    if (!device) return false;
    const devName = path.basename(device).replace(/[0-9]+$/, "");
    const rotational = await fs.promises.readFile(`/sys/block/${devName}/queue/rotational`, "utf8");
    return rotational.trim() === "0";
  }

  private async detectSSDMac(): Promise<boolean> {
    const { stdout } = await execFileAsync("system_profiler", ["SPStorageDataType"], { timeout: 6000 });
    return stdout.toLowerCase().includes("solid");
  }

  private async detectSSDWindows(targetPath: string): Promise<boolean> {
    const driveLetter = path.parse(path.resolve(targetPath)).root.replace(/\\/g, "").replace(":", "");
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command",
       [
         `$partition = Get-Partition -DriveLetter '${driveLetter}' -ErrorAction Stop`,
         "$disk = Get-Disk -Number $partition.DiskNumber -ErrorAction Stop",
         'if ($disk.MediaType) { Write-Output $disk.MediaType }',
       ].join("; ")],
      { timeout: 8000 }
    );
    return stdout.toLowerCase().includes("ssd");
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
