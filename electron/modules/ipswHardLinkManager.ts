import fs from "fs/promises";
import path from "path";
import { BrowserWindow } from "electron";
import { DataHandle } from "./dataHandle";
import { IPSWFile, IPSWWatcher } from "./ipswWatcher";

export interface HardLinkManagerConfig {
  savePath: string;
  enabled: boolean;
}

export interface HardLinkRecord {
  sourcePath: string;
  linkPath: string;
  deviceNames: string[];
  version: string;
  fileName: string;
}

interface MatchedDeviceInfo {
  deviceName: string;
  firmwareId: string;
  buildId: string;
}

const HARD_LINK_FOLDER = "IPSW_Files";

export class IPSWHardLinkManager {
  private readonly watcher: IPSWWatcher;
  private readonly dataHandle: DataHandle;
  private savePath: string;
  private enabled: boolean;
  private readonly records = new Map<string, HardLinkRecord>();

  constructor(_win: BrowserWindow, watcher: IPSWWatcher, dataHandle: DataHandle, config: HardLinkManagerConfig) {
    this.watcher = watcher;
    this.dataHandle = dataHandle;
    this.savePath = path.resolve(config.savePath);
    this.enabled = config.enabled;
  }

  async start(): Promise<void> {
    await this.syncFolder();
    if (!this.enabled) return;

    this.watcher.onFilesAdded((files) => void this.handleAdded(files));
    this.watcher.onFilesRemoved((files) => void this.handleRemoved(files));
    await this.checkAndCreateHardLinks();
  }

  async checkAndCreateHardLinks(): Promise<void> {
    await this.syncFolder();
    if (!this.enabled) return;
    await this.rebuildFromWatcher();
  }

  async updateConfig(config: HardLinkManagerConfig): Promise<void> {
    this.savePath = path.resolve(config.savePath);
    this.enabled = config.enabled;

    await this.syncFolder();
    if (this.enabled) {
      await this.rebuildFromWatcher();
    } else {
      await this.cleanupFolder(true);
    }
  }

  async stop(): Promise<void> {
    await this.cleanupFolder();
  }

  private async syncFolder(): Promise<void> {
    await fs.mkdir(this.folderPath, { recursive: true });
  }

  private get folderPath(): string {
    return path.join(this.savePath, HARD_LINK_FOLDER);
  }

  private async rebuildFromWatcher(): Promise<void> {
    const files = this.watcher.getFiles();
    await Promise.all(files.map((file) => this.createLinkForFile(file)));
  }

  private async handleAdded(files: IPSWFile[]): Promise<void> {
    if (!this.enabled) return;
    await Promise.all(files.map((file) => this.createLinkForFile(file)));
  }

  private async handleRemoved(files: IPSWFile[]): Promise<void> {
    await Promise.all(files.map((file) => this.removeLinkForFile(file.path)));
  }

  private async createLinkForFile(file: IPSWFile): Promise<void> {
    const parsed = this.parseIPSW(file.name);
    if (!parsed) return;

    const sourceExists = await fs.access(file.path).then(() => true).catch(() => false);
    if (!sourceExists) return;

    const matched = await this.getMatchedDevicesForFile(parsed.id, parsed.build);
    const deviceNames = [...new Set(matched.map((item) => item.deviceName))];
    if (!deviceNames.length) return;

    const record = this.buildRecord(file.path, deviceNames, parsed.version);
    const formattedLinkPath = path.join(this.folderPath, this.formatLinkFileName(deviceNames, parsed.version));

    if (this.records.get(file.path)?.linkPath === formattedLinkPath) return;

    await fs.mkdir(this.folderPath, { recursive: true });

    const linkExists = await fs.access(record.linkPath).then(() => true).catch(() => false);
    if (linkExists) {
      this.records.set(file.path, {
        ...record,
        linkPath: formattedLinkPath,
        fileName: path.basename(formattedLinkPath),
      });
      return;
    }

    try {
      await fs.link(file.path, record.linkPath);
      if (record.linkPath !== formattedLinkPath) {
        await fs.rename(record.linkPath, formattedLinkPath);
      }
      this.records.set(file.path, {
        ...record,
        linkPath: formattedLinkPath,
        fileName: path.basename(formattedLinkPath),
      });
    } catch (error: any) {
      console.error("[IPSWHardLinkManager] Failed to create hard link:", {
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        source: file.path,
        linkPath: record.linkPath,
        formattedLinkPath,
      });

      if (error?.code === "ENOENT") return;
      if (error?.code === "EEXIST") {
        this.records.set(file.path, {
          ...record,
          linkPath: formattedLinkPath,
          fileName: path.basename(formattedLinkPath),
        });
      }
    }
  }

  private async removeLinkForFile(sourcePath: string): Promise<void> {
    const record = this.records.get(sourcePath);
    if (!record) return;

    try {
      await fs.unlink(record.linkPath);
    } catch {
      // ignore missing link
    }
    this.records.delete(sourcePath);
  }

  private async cleanupFolder(removeFolder = false): Promise<void> {
    const entries = await fs.readdir(this.folderPath).catch(() => [] as string[]);
    await Promise.all(entries.map((entry) => fs.unlink(path.join(this.folderPath, entry)).catch(() => {})));

    if (removeFolder) {
      await fs.rmdir(this.folderPath).catch(() => {});
    }
    this.records.clear();
  }

  private buildRecord(sourcePath: string, deviceNames: string[], version: string): HardLinkRecord {
    const rawName = `${deviceNames.join("_").trim()}_${version}.ipsw`;
    const fileName = this.normalizeFileName(rawName);
    return {
      sourcePath,
      linkPath: path.join(this.folderPath, fileName),
      deviceNames,
      version,
      fileName,
    };
  }

  private formatLinkFileName(deviceNames: string[], version: string): string {
    const normalizedNames = this.normalizeDeviceNames(deviceNames);
    const groupedNames = this.groupDeviceNames(normalizedNames);
    const label = groupedNames.length ? groupedNames.join(" - ") : normalizedNames.join(" - ");
    return this.normalizeFileName(`${label} (${version}).ipsw`);
  }

  private normalizeDeviceNames(deviceNames: string[]): string[] {
    const cleaned = deviceNames.map((name) => this.cleanDeviceName(name)).filter(Boolean);
    return [...new Set(cleaned)];
  }

  private cleanDeviceName(name: string): string {
    return name
      .replace(/\(([^)]*)\)/g, (_match: string, inner: string) => {
        const filtered = inner
          .split(",")
          .map((part: string) => part.trim())
          .filter((part: string) => !/^global$/i.test(part) && !/^gsm$/i.test(part) && !/^wifi$/i.test(part) && !/^cellular$/i.test(part));
        return filtered.length ? `(${filtered.join(", ")})` : "";
      })
      .replace(/\s+/g, " ")
      .replace(/\s+_/g, "_")
      .replace(/_\s+/g, "_")
      .replace(/\s+,/g, ",")
      .replace(/,\s+/g, ", ")
      .replace(/\(\s*\)/g, "")
      .trim();
  }

  private groupDeviceNames(deviceNames: string[]): string[] {
    const modelMap = new Map<string, string>();
    for (const name of deviceNames) {
      const baseName = name.replace(/\s*\([^)]*\)/g, "").trim();
      const existing = modelMap.get(baseName);
      if (!existing || name.length < existing.length) {
        modelMap.set(baseName, name);
      }
    }

    const grouped = [...modelMap.values()];
    if (grouped.length <= 1) return grouped;

    const baseCounts = new Map<string, number>();
    for (const name of deviceNames) {
      const baseName = name.replace(/\s*\([^)]*\)/g, "").trim();
      baseCounts.set(baseName, (baseCounts.get(baseName) ?? 0) + 1);
    }

    const repeatedModels = [...baseCounts.entries()].filter(([, count]) => count > 1).map(([baseName]) => baseName);
    if (!repeatedModels.length) return grouped;

    return [...new Set(repeatedModels)].sort();
  }

  private normalizeFileName(fileName: string): string {
    const maxBaseLength = 180;
    const sanitized = fileName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/_+/g, "_")
      .trim();

    if (sanitized.length <= maxBaseLength) return sanitized;

    const ext = path.extname(sanitized) || ".ipsw";
    const base = path.basename(sanitized, ext);
    const shortBase = base.slice(0, Math.max(1, maxBaseLength - ext.length - 1)).replace(/_+$/g, "");
    return `${shortBase}${ext}`;
  }

  private parseIPSW(filename: string): {
    id: string;
    version: string;
    build: string;
  } | null {
    const regex = /^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;
    const match = filename.match(regex);
    if (!match?.groups) return null;
    return {
      id: match.groups.id,
      version: match.groups.version,
      build: match.groups.build,
    };
  }

  private async getMatchedDevicesForFile(fileId: string, fileBuild: string): Promise<MatchedDeviceInfo[]> {
    const devices = this.dataHandle.getDevices();
    const matched = new Map<string, MatchedDeviceInfo>();

    for (const device of devices) {
      const modelData = await this.dataHandle.getModelData(device.identifier);
      if (!modelData) continue;

      for (const firmware of modelData.firmwares ?? []) {
        const parsed = this.parseIPSW(firmware.url.split("/").pop() ?? "");
        if (!parsed) continue;

        if (parsed.id === fileId && parsed.build === fileBuild) {
          matched.set(device.identifier, {
            deviceName: device.name,
            firmwareId: parsed.id,
            buildId: parsed.build,
          });
          break;
        }
      }
    }

    return [...matched.values()];
  }
}
