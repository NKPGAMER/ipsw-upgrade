import type { CardTask, DeviceEntry } from "./types";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { parseIPSW, getFileNameFromUrl } from "@/core/helper";

export function resolveProduct(identifier: string): Product {
  const lower = identifier.toLowerCase();
  if (lower.startsWith("ipad")) return "ipad";
  if (lower.startsWith("watch")) return "watch";
  if (lower.startsWith("mac")) return "mac";
  if (lower.startsWith("appletv")) return "tv";
  if (lower.startsWith("audioaccessory")) return "homepod";
  if (lower.startsWith("realitydevice")) return "realitydevice";
  if (lower.startsWith("ipod")) return "ipod";
  return "iphone";
}

export function computeCardStatus(
  entry: DeviceEntry,
  allFiles: IPSWFile[],
  incompleteTasks: IncompleteTaskClient[],
  linkedGroup?: Set<string>,
): CardTask {
  if (entry.firmwares != null || entry.task) {
    const inProgress = !!entry.task &&
      ["downloading", "paused", "queued", "verifying", "transferring", "queueTransfer"].includes(entry.task.status);
    if (inProgress) return entry.task!.status as CardTask;
    if (entry.task?.status === "completed") return "completed";
    if (entry.task?.status === "error") return "error";
  }

  if (!entry.firmwares || entry.firmwares.length === 0) {
    return "none";
  }

  const latestFw = entry.firmwares[0];

  let incompTask = incompleteTasks.find(
    (t) =>
      t.firmware.identifier === entry.device.identifier &&
      t.firmware.buildid === latestFw.buildid
  );
  if (!incompTask && linkedGroup) {
    for (const linkedId of linkedGroup) {
      if (linkedId === entry.device.identifier) continue;
      incompTask = incompleteTasks.find(
        t => t.firmware.identifier === linkedId && t.firmware.buildid === latestFw.buildid
      );
      if (incompTask) break;
    }
  }
  if (incompTask) return "incomplete_dl";

  if (latestFw?.signed && allFiles.length > 0) {
    const info = parseIPSW(getFileNameFromUrl(latestFw.url));
    if (info) {
      const buildIdMap = new Set(entry.firmwares.map(fw => fw.buildid));
      const deviceFiles = allFiles.filter(file => {
        const parsed = parseIPSW(file.name);
        return parsed?.id === info.id && buildIdMap.has(parsed.build);
      });
      if (deviceFiles.length > 0) {
        const latestFile = deviceFiles.find(f => f.name.includes(latestFw.buildid));
        if (latestFile) {
          if (latestFw.filesize > 0 && latestFile.size < latestFw.filesize) {
            return "corrupted";
          }
          return "downloaded";
        }
        return "old";
      }
    }
  }

  return entry.task?.status ?? "none";
}
