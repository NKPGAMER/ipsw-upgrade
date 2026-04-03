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
class DiskManager {
    usageTracker = new Map();
    // Cache SSD detection per drive — only needs to run once per session
    ssdCache = new Map();
    // Cache disk space per dir — valid for 5 seconds
    spaceCache = new Map();
    SPACE_CACHE_TTL = 5000;
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
    async chooseTmpDir(savePath, requiredBytes, preferredTmpDir) {
        const candidates = [];
        if (preferredTmpDir)
            candidates.push(preferredTmpDir);
        candidates.push(process.env.TMPDIR || process.env.TEMP || "/tmp");
        candidates.push(path.dirname(path.resolve(savePath)));
        const probes = await Promise.all(candidates.map(async (dir) => {
            try {
                if (!fs.existsSync(dir))
                    fs.mkdirSync(dir, { recursive: true });
                const info = await this.getDiskInfo(dir);
                return { dir, info };
            }
            catch {
                return null;
            }
        }));
        for (const p of probes) {
            if (p && p.info.isSSd && p.info.available >= requiredBytes + 1 * 1024 ** 3)
                return p.dir;
        }
        for (const p of probes) {
            if (p && p.info.available >= requiredBytes)
                return p.dir;
        }
        return path.dirname(path.resolve(savePath));
    }
    async hasEnoughSpace(savePath, firmwareSize, bufferBytes = 5 * 1024 ** 3) {
        const currentUsage = Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0);
        const required = firmwareSize + currentUsage + bufferBytes;
        const info = await this.getDiskInfo(savePath);
        return { ok: info.available >= required, available: info.available, required };
    }
    reserveSpace(taskId, bytes) { this.usageTracker.set(taskId, bytes); }
    releaseSpace(taskId) { this.usageTracker.delete(taskId); }
    getTotalReserved() { return Array.from(this.usageTracker.values()).reduce((a, b) => a + b, 0); }
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
        catch { /* older Node — fall back to subprocess */ }
        try {
            if (process.platform === "win32")
                return await this.getStatfsWindows(dir);
            return await this.getStatfsUnix(dir);
        }
        catch {
            return { available: 50 * 1024 ** 3, total: 100 * 1024 ** 3 };
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
    async getStatfsUnix(dir) {
        const { stdout } = await execFileAsync("df", ["-k", dir], { timeout: 5000 });
        const lines = stdout.trim().split("\n");
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        return { total: parseInt(parts[1]) * 1024, available: parseInt(parts[3]) * 1024 };
    }
    // ─── Async SSD detection ─────────────────────────────────────────────────────
    async detectSSDUncached(targetPath) {
        try {
            if (process.platform === "linux")
                return await this.detectSSDLinux(targetPath);
            if (process.platform === "darwin")
                return await this.detectSSDMac();
            if (process.platform === "win32")
                return await this.detectSSDWindows();
        }
        catch { /* fall through */ }
        return false;
    }
    async detectSSDLinux(targetPath) {
        const { stdout } = await execFileAsync("df", [targetPath], { timeout: 3000 });
        const device = stdout.trim().split("\n")[1]?.split(/\s+/)[0];
        if (!device)
            return false;
        const devName = path.basename(device).replace(/[0-9]+$/, "");
        const rotational = await fs.promises.readFile(`/sys/block/${devName}/queue/rotational`, "utf8");
        return rotational.trim() === "0";
    }
    async detectSSDMac() {
        const { stdout } = await execFileAsync("system_profiler", ["SPStorageDataType"], { timeout: 6000 });
        return stdout.toLowerCase().includes("solid");
    }
    async detectSSDWindows() {
        const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
            "Get-PhysicalDisk | Select-Object -ExpandProperty MediaType"], { timeout: 8000 });
        return stdout.toLowerCase().includes("ssd");
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
