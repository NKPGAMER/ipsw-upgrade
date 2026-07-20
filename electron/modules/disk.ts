import { getDiskInfo } from '../i10r-addon';

interface DiskSpace {
    total: number;
    used: number;
    available: number;
    percentage: number;
    mount: string;
}

function getDiskSpace(targetPath: string): DiskSpace | void {
  if (!targetPath) return;

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

export { getDiskSpace };
