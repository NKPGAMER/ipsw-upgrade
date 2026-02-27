import { execSync } from 'child_process';
import { platform } from 'os';
import { parse, resolve } from "path";

function getDiskSpace(targetPath?: string): DiskSpace {
  const p = platform();
  const checkPath = targetPath || process.cwd();

  if (p === 'win32') {
    return getWindowsDiskSpace(checkPath);
  } else {
    return getUnixDiskSpace(checkPath);
  }
}
function getWindowsDiskSpace(targetPath: string): DiskSpace {
  try {
    // Get drive letter from path
    const driveLetter = parse(resolve(targetPath)).root;

    // Use PowerShell to get disk info
    const cmd = `powershell "Get-PSDrive -Name ${driveLetter.charAt(0)} | Select-Object Used,Free | ConvertTo-Json"`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(output);

    const used = parseInt(data.Used);
    const free = parseInt(data.Free);
    const total = used + free;
    const percentage = (used / total) * 100;

    return {
      total,
      used,
      available: free,
      percentage: Math.round(percentage * 100) / 100,
      mount: driveLetter
    };
  } catch (error) {
    throw new Error(`Failed to get disk space for Windows: ${error}`);
  }
}
function getUnixDiskSpace(targetPath: string): DiskSpace {
  try {
    const absolutePath = resolve(targetPath);

    // Use df command with 1K blocks for consistency
    const cmd = `df -k "${absolutePath}" | tail -1`;
    const output = execSync(cmd, { encoding: 'utf8' });

    // Parse df output
    const parts = output.trim().split(/\s+/);
    const total = parseInt(parts[1]) * 1024;     // convert KB to bytes
    const used = parseInt(parts[2]) * 1024;
    const available = parseInt(parts[3]) * 1024;
    const percentage = parseFloat(parts[4]);
    const mount = parts[5];

    return {
      total,
      used,
      available,
      percentage,
      mount
    };
  } catch (error) {
    throw new Error(`Failed to get disk space for Unix: ${error}`);
  }
}
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export { getDiskSpace, formatBytes };