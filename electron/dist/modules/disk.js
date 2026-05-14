"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiskSpace = getDiskSpace;
exports.formatBytes = formatBytes;
const child_process_1 = require("child_process");
const util_1 = require("util");
const os_1 = require("os");
const path_1 = require("path");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function getDiskSpace(targetPath) {
    const checkPath = targetPath || process.cwd();
    if ((0, os_1.platform)() === 'win32') {
        return getWindowsDiskSpace(checkPath);
    }
    return getUnixDiskSpace(checkPath);
}
async function getWindowsDiskSpace(targetPath) {
    const driveLetter = (0, path_1.parse)((0, path_1.resolve)(targetPath)).root.charAt(0);
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `$d=Get-PSDrive -Name ${driveLetter};Write-Output "$($d.Free) $($d.Used)"`], { timeout: 8000 });
    const [freeStr, usedStr] = stdout.trim().split(" ");
    const free = parseInt(freeStr);
    const used = parseInt(usedStr);
    if (isNaN(free) || isNaN(used)) {
        throw new Error(`Failed to parse PowerShell output: ${stdout}`);
    }
    const total = free + used;
    const percentage = (used / total) * 100;
    return {
        total,
        used,
        available: free,
        percentage: Math.round(percentage * 100) / 100,
        mount: driveLetter + ":\\"
    };
}
async function getUnixDiskSpace(targetPath) {
    const absolutePath = (0, path_1.resolve)(targetPath);
    const { stdout } = await execFileAsync("df", ["-k", absolutePath], { timeout: 8000 });
    const lines = stdout.trim().split("\n");
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    const total = parseInt(parts[1]) * 1024;
    const used = parseInt(parts[2]) * 1024;
    const available = parseInt(parts[3]) * 1024;
    const percentage = parseFloat(parts[4]);
    const mount = parts[5];
    return { total, used, available, percentage, mount };
}
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
