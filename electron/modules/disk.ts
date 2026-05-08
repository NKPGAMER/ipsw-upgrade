import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { parse, resolve } from "path";

const execFileAsync = promisify(execFile);

async function getDiskSpace(targetPath?: string): Promise<DiskSpace> {
  const checkPath = targetPath || process.cwd();

  if (platform() === 'win32') {
    return getWindowsDiskSpace(checkPath);
  }
  return getUnixDiskSpace(checkPath);
}

async function getWindowsDiskSpace(targetPath: string): Promise<DiskSpace> {
  const driveLetter = parse(resolve(targetPath)).root.charAt(0);

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command",
     `$d=Get-PSDrive -Name ${driveLetter};Write-Output "$($d.Free) $($d.Used)"`],
    { timeout: 8000 }
  );

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

async function getUnixDiskSpace(targetPath: string): Promise<DiskSpace> {
  const absolutePath = resolve(targetPath);

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

function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export { getDiskSpace, formatBytes };
