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
exports.DiskManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const GB = 1024 ** 3;
class DiskManager {
    usageTracker = new Map();
    // Cache SSD detection per drive — only needs to run once per session
    ssdCache = new Map();
    // Cache disk space per dir — valid for 5 seconds
    spaceCache = new Map();
    SPACE_CACHE_TTL = 5000;
    // Cache full drive enumeration — drives don't change during a session (30s TTL)
    drivesCache = null;
    DRIVES_CACHE_TTL = 30000;
    // ─── Public API ─────────────────────────────────────────────────────────────
    async getDiskInfo(targetPath) {
        const resolved = path.resolve(targetPath);
        const dir = this.resolveDir(resolved);
        const [stats, isSSd] = await Promise.all([
            this.getStatfs(dir),
            this.detectSSD(dir),
        ]);
        return { path: dir, available: stats.available, total: stats.total, isSSd };
    }
    async detectSSD(targetPath) {
        const key = this.driveKey(targetPath);
        if (this.ssdCache.has(key))
            return this.ssdCache.get(key);
        const result = await this.detectSSDUncached(targetPath);
        this.ssdCache.set(key, result);
        return result;
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
    async chooseTmpDir(savePath, requiredBytes, fileSize, preferredTmpDir) {
        const buffer = 1 * GB;
        const minSpace = Math.max(requiredBytes, fileSize) + buffer;
        // If user specified a preferred dir that exists and is an SSD with enough room, use it.
        if (preferredTmpDir) {
            try {
                const resolved = path.resolve(preferredTmpDir);
                if (!fs.existsSync(resolved))
                    fs.mkdirSync(resolved, { recursive: true });
                const info = await this.getDiskInfo(resolved);
                if (info.isSSd && info.available >= minSpace)
                    return resolved;
            }
            catch { /* try the drive-scan path */ }
        }
        // Enumerate all drives, filter, score
        const drives = await this.getAllDrives();
        const ssdCandidates = drives.filter(d => d.isSSd && d.available >= minSpace);
        if (ssdCandidates.length === 0)
            return null;
        const saveDriveKey = this.driveKey(savePath);
        const scored = ssdCandidates.map(d => ({
            dir: d.path,
            score: this.scoreDrive(d, requiredBytes, saveDriveKey),
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored[0].dir;
    }
    async hasEnoughSpace(savePath, firmwareSize, bufferBytes = 5 * GB, deleteOnRun = []) {
        let freeAfterDelete = 0;
        if (deleteOnRun) {
            freeAfterDelete = deleteOnRun.reduce((a, b) => a + b.size, 0);
        }
        const currentUsage = Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0);
        const required = Math.max(0, firmwareSize + currentUsage + bufferBytes - freeAfterDelete);
        const info = await this.getDiskInfo(savePath);
        return { ok: info.available >= required, available: info.available, required };
    }
    reserveSpace(taskId, bytes) { this.usageTracker.set(taskId, bytes); }
    releaseSpace(taskId) { this.usageTracker.delete(taskId); }
    getTotalReserved() { return Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0); }
    /**
     * Analyse the disk environment for a given save path.
     * Used by the UI to show what kind of storage layout is active.
     */
    async getEnvironmentInfo(savePath) {
        const saveResolved = path.resolve(savePath);
        const saveDir = this.resolveDir(saveResolved);
        const isSSD = await this.detectSSD(saveDir);
        const saveMount = this.driveKey(saveDir);
        const saveDrive = {
            path: saveMount,
            mediaType: isSSD ? "SSD" : "HDD",
        };
        let environment;
        let tmpDrive = null;
        if (isSSD) {
            environment = "ssd_save";
        }
        else {
            const tmpDir = await this.chooseTmpDir(savePath, 1 * GB, 1 * GB);
            if (tmpDir !== null) {
                environment = "hdd_ssd_tmp";
                tmpDrive = { path: this.driveKey(tmpDir), mediaType: "SSD" };
            }
            else {
                environment = "hdd_only";
            }
        }
        return { environment, saveDrive, tmpDrive };
    }
    // ─── Async disk space ────────────────────────────────────────────────────────
    async getStatfs(dir) {
        const cached = this.spaceCache.get(dir);
        if (cached && Date.now() - cached.ts < this.SPACE_CACHE_TTL)
            return cached.result;
        const result = await this.getStatfsUncached(dir);
        this.spaceCache.set(dir, { result, ts: Date.now() });
        return result;
    }
    async getStatfsUncached(dir) {
        // Try native fs.statfs first (Node 19+, truly non-blocking)
        try {
            const s = await fs.promises.statfs(dir);
            return { available: s.bavail * s.bsize, total: s.blocks * s.bsize };
        }
        catch { /* older Node — fall back to PowerShell */ }
        try {
            return await this.getStatfsWindows(dir);
        }
        catch {
            return { available: 50 * GB, total: 100 * GB };
        }
    }
    async getStatfsWindows(dir) {
        const driveLetter = path.parse(dir).root.replace(/\\/g, "").replace(":", "");
        const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
            `$d=Get-PSDrive ${driveLetter};Write-Output "$($d.Free) $($d.Used)"`], { timeout: 8000 });
        const [freeStr, usedStr] = stdout.trim().split(" ");
        const free = parseInt(freeStr);
        const used = parseInt(usedStr);
        if (!isNaN(free) && !isNaN(used))
            return { available: free, total: free + used };
        throw new Error("PowerShell parse failed");
    }
    // ─── SSD detection (Windows-only) ───────────────────────────────────────────
    async detectSSDUncached(targetPath) {
        try {
            return await this.detectSSDWindows(targetPath);
        }
        catch { /* fall through */ }
        return false;
    }
    async detectSSDWindows(targetPath) {
        const driveLetter = path.parse(path.resolve(targetPath)).root.replace(/\\/g, "").replace(":", "");
        // Primary: Get-PhysicalDisk via Storage module (most reliable)
        try {
            const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
                `$p=Get-Partition -DriveLetter '${driveLetter}' -ErrorAction SilentlyContinue;` +
                    `if($p){$d=Get-PhysicalDisk -DeviceNumber $p.DiskNumber -ErrorAction SilentlyContinue;` +
                    `if($d.MediaType){Write-Output $d.MediaType}}`], { timeout: 8000 });
            const trimmed = stdout.trim();
            if (trimmed === "SSD")
                return true;
            if (trimmed === "HDD")
                return false;
        }
        catch { /* fall through to fsutil */ }
        // Fallback: fsutil sectorinfo (no admin needed on Win10+)
        try {
            const { stdout } = await execFileAsync("fsutil", ["fsinfo", "sectorinfo", `${driveLetter}:`], { timeout: 5000 });
            // fsutil outputs "SSD" for SSDs, "Not SSD" for HDDs
            // "Not SSD" contains "SSD" as substring, so check for it first
            if (/not\s+ssd/i.test(stdout))
                return false;
            if (/^\s*SSD\s*$/im.test(stdout))
                return true;
        }
        catch { /* fall through */ }
        // Last resort: check model name via WMI for NVMe/SSD keywords
        try {
            const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
                `$p=Get-Partition -DriveLetter '${driveLetter}' -ErrorAction SilentlyContinue;` +
                    `if($p){$d=Get-CimInstance Win32_DiskDrive | Where-Object Index -eq $p.DiskNumber;` +
                    `if($d){Write-Output "$($d.Model) $($d.MediaType)"}}`], { timeout: 8000 });
            const lower = stdout.toLowerCase();
            if (lower.includes("ssd") || lower.includes("nvme"))
                return true;
        }
        catch { /* give up */ }
        return false;
    }
    // ─── Drive enumeration ──────────────────────────────────────────────────────
    async getAllDrives() {
        // Return fresh cache — drives don't change during a session
        if (this.drivesCache && Date.now() - this.drivesCache.ts < this.DRIVES_CACHE_TTL) {
            return this.drivesCache.result;
        }
        // Collect existing drive roots first (sync existsSync is fast)
        const roots = [];
        for (let letter = 67; letter <= 90; letter++) {
            const root = `${String.fromCharCode(letter)}:\\`;
            if (fs.existsSync(root))
                roots.push(root);
        }
        // Query all drives in parallel — each getDiskInfo does getStatfs + detectSSD concurrently
        const settled = await Promise.allSettled(roots.map(r => this.getDiskInfo(r)));
        const drives = [];
        for (const s of settled) {
            if (s.status === "fulfilled")
                drives.push(s.value);
        }
        this.drivesCache = { result: drives, ts: Date.now() };
        return drives;
    }
    /** Score an SSD drive — higher is better. */
    scoreDrive(drive, requiredBytes, saveDriveKey) {
        let score = 0;
        // Free space headroom after required (0–50 pts, 2 pts per GB)
        const headroomGB = (drive.available - requiredBytes) / GB;
        score += Math.min(50, Math.floor(Math.max(0, headroomGB) * 2));
        // Non-system drive bonus (30 pts) — avoids competing with OS paging / I/O
        if (!drive.path.toUpperCase().startsWith("C:"))
            score += 30;
        // Same drive as savePath bonus (20 pts) — rename is instant on same volume
        if (this.driveKey(drive.path) === saveDriveKey)
            score += 20;
        // Larger total capacity hints at better controller / more channels (0–20 pts)
        const totalGB = drive.total / GB;
        score += Math.min(20, Math.floor(totalGB / 50));
        return score;
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
    resolveDir(resolved) {
        try {
            return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
                ? resolved : path.dirname(resolved);
        }
        catch {
            return path.dirname(resolved);
        }
    }
    driveKey(filePath) {
        const resolved = path.resolve(filePath);
        if (process.platform === "win32")
            return path.parse(resolved).root.toUpperCase();
        const parts = resolved.split(path.sep).filter(Boolean);
        return path.sep + (parts[0] ?? "");
    }
}
exports.DiskManager = DiskManager;
