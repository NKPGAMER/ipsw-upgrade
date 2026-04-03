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
exports.getDriveType = getDriveType;
exports.getDriveLetter = getDriveLetter;
exports.findBestSSDTempDir = findBestSSDTempDir;
exports.resolveTempDir = resolveTempDir;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Detect if a Windows drive letter is SSD or HDD.
 * Falls back to UNKNOWN on non-Windows or errors.
 */
function getDriveType(driveLetter) {
    if (process.platform !== "win32")
        return "UNKNOWN";
    try {
        // Use PowerShell to query physical disk media type
        const letter = driveLetter.replace(":", "").toUpperCase();
        const ps = `Get-PhysicalDisk | Where-Object { (Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue).DriveLetter -contains '${letter}' } | Select-Object -ExpandProperty MediaType`;
        const result = (0, child_process_1.execSync)(`powershell -NoProfile -Command "${ps}"`, {
            timeout: 5000,
        })
            .toString()
            .trim();
        if (result.includes("SSD"))
            return "SSD";
        if (result.includes("HDD"))
            return "HDD";
    }
    catch {
        // ignore
    }
    return "UNKNOWN";
}
/**
 * Extract drive letter from a full path (Windows only).
 * Returns null on non-Windows.
 */
function getDriveLetter(filePath) {
    if (process.platform !== "win32")
        return null;
    const parsed = path.parse(path.resolve(filePath));
    const root = parsed.root; // e.g. "C:\\"
    if (!root)
        return null;
    return root.replace(":\\", "").replace(":/", "").toUpperCase();
}
/**
 * Find the best SSD temp directory available on the system.
 * Priority: C:\ SSD (almost always SSD on modern machines) → system temp.
 */
function findBestSSDTempDir() {
    if (process.platform === "win32") {
        // Try common SSD candidates
        const candidates = ["C:\\Temp", os.tmpdir()];
        for (const c of candidates) {
            try {
                if (!fs.existsSync(c))
                    fs.mkdirSync(c, { recursive: true });
                const letter = getDriveLetter(c);
                if (letter) {
                    const type = getDriveType(letter);
                    if (type === "SSD" || type === "UNKNOWN")
                        return c;
                }
            }
            catch {
                // continue
            }
        }
        return os.tmpdir();
    }
    return os.tmpdir();
}
/**
 * Determine the actual temp directory to use for a download task.
 *
 * Logic:
 *  - If destPath drive is SSD → use destPath parent (write directly)
 *  - If destPath drive is C and HDD → use system temp + write sequentially
 *  - If destPath drive is non-C HDD → use SSD temp dir, then move after merge
 */
function resolveTempDir(destPath, taskId, tempBaseOverride) {
    const tempBase = tempBaseOverride ?? findBestSSDTempDir();
    const taskTemp = path.join(tempBase, "dm_tmp", taskId);
    if (process.platform !== "win32") {
        // On macOS/Linux just use system temp
        return { tempDir: taskTemp, useDirectWrite: false, isHDDDest: false };
    }
    const destLetter = getDriveLetter(destPath);
    if (!destLetter) {
        return { tempDir: taskTemp, useDirectWrite: false, isHDDDest: false };
    }
    const driveType = getDriveType(destLetter);
    if (driveType === "SSD" || driveType === "UNKNOWN") {
        // Write temp parts directly next to destination
        const directTemp = path.join(path.dirname(destPath), `.dm_tmp_${taskId}`);
        return { tempDir: directTemp, useDirectWrite: true, isHDDDest: false };
    }
    // HDD destination — use SSD temp dir
    return { tempDir: taskTemp, useDirectWrite: false, isHDDDest: true };
}
