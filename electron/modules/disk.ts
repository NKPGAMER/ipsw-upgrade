import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { parse, resolve } from "path";
import { getDiskInfo } from '../i10r-addon';

interface DiskSpace {
    total: number;
    used: number;
    available: number;
    percentage: number;
    mount: string;
}

function getDiskSpace(targetPath: string): DiskSpace | void {
  const disk_info = getDiskInfo(targetPath);

  if (!disk_info) return;

  const percentage = (disk_info.usedSpace / disk_info.totalSpace) * 100;

  return {
    total: disk_info.totalSpace,
    used: disk_info.usedSpace,
    available: disk_info.freeSpace,
    percentage: Math.round(percentage * 100) / 100,
    mount: disk_info.id
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
