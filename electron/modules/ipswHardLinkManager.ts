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

    await this.syncHardLinks();
  }

  async updateConfig(config: HardLinkManagerConfig): Promise<void> {
    this.savePath = path.resolve(config.savePath);
    this.enabled = config.enabled;

    await this.syncFolder();
    if (this.enabled) {
      await this.rebuildFromWatcher();
    } else {
      await this.cleanupFolder();
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

  private async syncHardLinks(): Promise<void> {
    const files = this.watcher.getFiles();
    const sourcePaths = new Set(files.map((file) => file.path));
    await this.cleanupOrphanLinks(sourcePaths);
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

    const deviceNames = await this.getDeviceNamesForFirmware(parsed.id);
    if (!deviceNames.length) return;

    const record = this.buildRecord(file.path, deviceNames, parsed.version);
    if (this.records.get(file.path)?.linkPath === record.linkPath) return;

    await fs.mkdir(this.folderPath, { recursive: true });
    await this.removeLinkForFile(file.path);

    try {
      await fs.link(file.path, record.linkPath);
      this.records.set(file.path, record);
    } catch (error) {
      console.error("[IPSWHardLinkManager] Failed to create hard link:", error);
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

  private async cleanupFolder(): Promise<void> {
    const entries = await fs.readdir(this.folderPath).catch(() => [] as string[]);
    await Promise.all(entries.map((entry) => fs.unlink(path.join(this.folderPath, entry)).catch(() => {})));
    this.records.clear();
  }

  private async cleanupOrphanLinks(activeSourcePaths: Set<string>): Promise<void> {
    const entries = await fs.readdir(this.folderPath).catch(() => [] as string[]);
    const activeLinkPaths = new Set(this.records.values().map((record) => record.linkPath));

    await Promise.all(entries.map(async (entry) => {
      const linkPath = path.join(this.folderPath, entry);
      const record = [...this.records.values()].find((item) => item.linkPath === linkPath);

      if (record) {
        if (activeSourcePaths.has(record.sourcePath)) return;
        try {
          await fs.unlink(linkPath);
          this.records.delete(record.sourcePath);
        } catch {
          // ignore missing or inaccessible link
        }
        return;
      }

      if (activeLinkPaths.has(linkPath)) return;

      try {
        await fs.unlink(linkPath);
      } catch {
        // ignore missing or inaccessible link
      }
    }));
  }

  private buildRecord(sourcePath: string, deviceNames: string[], version: string): HardLinkRecord {
    const fileName = `${deviceNames.join("_")}_${version}.ipsw`;
    return {
      sourcePath,
      linkPath: path.join(this.folderPath, fileName),
      deviceNames,
      version,
      fileName,
    };
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

  private async getDeviceNamesForFirmware(id: string): Promise<string[]> {
    const devices = this.dataHandle.getDevices();
    const matchedNames = new Set<string>();

    for (const device of devices) {
      const modelData = await this.dataHandle.getModelData(device.identifier);
      if (!modelData) continue;

      const firmware = modelData.firmwares[0];
      if (!firmware) continue;

      const parsed = this.parseIPSW(firmware.url.split('/').pop() ?? '');
      if (!parsed) continue;

      if (parsed.id === id) {
        matchedNames.add(device.name);
      }
    }

    return [...matchedNames];
  }
}
