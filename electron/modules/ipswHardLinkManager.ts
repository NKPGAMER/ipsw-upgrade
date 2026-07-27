import fs from "fs-extra";
import path from "path";
import { BrowserWindow } from "electron";
import { DataHandle } from "../services/ipswData";
import { IPSWFile, IPSWWatcher } from "./ipswWatcher";

export interface HardLinkManagerConfig {
  watchDir: string;
  outDir?: string;
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

const HARD_LINK_FOLDER = "IPSW_FILES";
const MAX_CONCURRENT_LINKS = 8;

const IPSW_PARSE_RE = /^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;
const PARENS_CONTENT_RE = /\(([^)]*)\)/g;
const SKIP_VARIANT_RE = /^(global|gsm|wifi|cellular)$/i;
const SPECIAL_CHARS_RE = /[<>:"/\\|?*\x00-\x1F]/g;
const BASE_NAME_RE = /\s*\([^)]*\)/g;

export class IPSWHardLinkManager {
  private readonly watcher: IPSWWatcher;
  private readonly dataHandle: DataHandle;
  private readonly config: HardLinkManagerConfig;
  private readonly records = new Map<string, HardLinkRecord>();
  private readonly deviceFirmwareCache = new Map<string, MatchedDeviceInfo[]>();
  private firmwareCachePromise: Promise<void> | null = null;
  private isRunning = false;
  private pendingFileNames = new Set<string>();
  private addedDisposer: (() => void) | null = null;
  private removedDisposer: (() => void) | null = null;

  constructor(_win: BrowserWindow, watcher: IPSWWatcher, dataHandle: DataHandle, config: HardLinkManagerConfig) {
    this.watcher = watcher;
    this.dataHandle = dataHandle;
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    await this.syncFolder();
    this.isRunning = true;
    if (!this.config.enabled) {
      await this.stop();
      return;
    }

    this.addedDisposer = this.watcher.onFilesAdded((files) => void this.handleAdded(files));
    this.removedDisposer = this.watcher.onFilesRemoved((files) => void this.handleRemoved(files));
    await this.checkAndCreateHardLinks();
  }

  async checkAndCreateHardLinks(): Promise<void> {
    await this.syncFolder();
    if (!this.config.enabled) return;
    await this.rebuildFromWatcher();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.addedDisposer?.();
    this.addedDisposer = null;
    this.removedDisposer?.();
    this.removedDisposer = null;
    await this.cleanupFolder();
  }

  invalidateDeviceCache(): void {
    this.deviceFirmwareCache.clear();
    this.firmwareCachePromise = null;
  }

  private async syncFolder(): Promise<void> {
    await fs.mkdir(this.folderPath, { recursive: true });
  }

  private get folderPath(): string {
    return path.join(this.config.watchDir, this.config.outDir || HARD_LINK_FOLDER);
  }

  private async rebuildFromWatcher(): Promise<void> {
    const files = this.watcher.getFiles();
    for (let i = 0; i < files.length; i += MAX_CONCURRENT_LINKS) {
      const batch = files.slice(i, i + MAX_CONCURRENT_LINKS);
      await Promise.all(batch.map((file) => this.createLinkForFile(file)));
    }
    await this.cleanupStaleLinks();
  }

  private async cleanupStaleLinks(): Promise<void> {
    const expectedNames = new Set<string>();
    for (const record of this.records.values()) {
      expectedNames.add(record.fileName);
    }

    const entries = await fs.readdir(this.folderPath).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((entry) => !expectedNames.has(entry) && !this.pendingFileNames.has(entry))
        .map((entry) =>
          fs.unlink(path.join(this.folderPath, entry)).catch(() => {})
        )
    );
  }

  private async handleAdded(files: IPSWFile[]): Promise<void> {
    if (!this.config.enabled) return;
    for (let i = 0; i < files.length; i += MAX_CONCURRENT_LINKS) {
      const batch = files.slice(i, i + MAX_CONCURRENT_LINKS);
      await Promise.all(batch.map((file) => this.createLinkForFile(file)));
    }
  }

  private async handleRemoved(files: IPSWFile[]): Promise<void> {
    if (!this.config.enabled) return;
    await Promise.all(files.map((file) => this.removeLinkForFile(file.path)));
  }

  private async createLinkForFile(file: IPSWFile): Promise<void> {
    const parsed = this.parseIPSW(file.name);
    if (!parsed) return;

    const sourceExists = await fs.access(file.path).then(() => true).catch(() => false);
    if (!sourceExists) return;

    const stableSize = await this.waitForStableSize(file.path);
    if (stableSize === null) return;
    const stableFile: IPSWFile = { ...file, size: stableSize };

    const matched = await this.getMatchedDevicesForFile(parsed.id, parsed.build);
    const deviceNames = [...new Set(matched.map((item) => item.deviceName))];
    if (!deviceNames.length) return;

    const fileName = this.formatLinkFileName(deviceNames, parsed.version);
    const linkPath = path.join(this.folderPath, fileName);

    if (this.records.get(stableFile.path)?.linkPath === linkPath) return;

    await fs.mkdir(this.folderPath, { recursive: true });

    this.pendingFileNames.add(fileName);
    try {
      try {
        await fs.link(stableFile.path, linkPath);
      } catch (error: any) {
        if (error?.code === "ENOENT") return;
        if (error?.code === "EXDEV") {
          await fs.copyFile(stableFile.path, linkPath);
        } else if (error?.code === "EEXIST") {
          const [linkStat, sourceStat] = await Promise.all([
            fs.stat(linkPath).catch(() => null),
            fs.stat(stableFile.path).catch(() => null),
          ]);
          if (linkStat && sourceStat && (linkStat.ino !== sourceStat.ino || linkStat.size !== sourceStat.size)) {
            await fs.unlink(linkPath);
            await fs.link(stableFile.path, linkPath);
          }
        } else {
          console.error("[IPSWHardLinkManager] Failed to create hard link:", error?.code, error?.message);
          return;
        }
      }

      this.records.set(stableFile.path, {
        sourcePath: stableFile.path,
        linkPath,
        deviceNames,
        version: parsed.version,
        fileName,
      });
    } finally {
      this.pendingFileNames.delete(fileName);
    }
  }

  private async waitForStableSize(filePath: string): Promise<number | null> {
    const first = await fs.stat(filePath).catch(() => null);
    if (!first) return null;

    await new Promise((resolve) => setTimeout(resolve, 500));

    const second = await fs.stat(filePath).catch(() => null);
    if (!second) return null;

    if (first.size === second.size && first.mtimeMs === second.mtimeMs) {
      return first.size;
    }

    return null;
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

  private formatLinkFileName(deviceNames: string[], version: string): string {
    const normalizedNames = this.normalizeDeviceNames(deviceNames);
    const groupedNames = this.groupDeviceNames(normalizedNames);
    const label = groupedNames.join(" - ");
    return this.normalizeFileName(`${label} (${version}).ipsw`);
  }

  private normalizeDeviceNames(deviceNames: string[]): string[] {
    const cleaned = deviceNames.map((name) => this.cleanDeviceName(name)).filter(Boolean);
    return [...new Set(cleaned)];
  }

  private cleanDeviceName(name: string): string {
    let result = name;
    result = result.replace(PARENS_CONTENT_RE, (_match: string, inner: string) => {
      const filtered = inner
        .split(",")
        .map((part: string) => part.trim())
        .filter((part: string) => !SKIP_VARIANT_RE.test(part));
      return filtered.length ? `(${filtered.join(", ")})` : "";
    });
    result = result.replace(/\s+/g, " ");
    result = result.replace(/\s+_/g, "_");
    result = result.replace(/_\s+/g, "_");
    result = result.replace(/\s+,/g, ",");
    result = result.replace(/,\s+/g, ", ");
    result = result.replace(/\(\s*\)/g, "");
    return result.trim();
  }

  private baseDeviceName(name: string): string {
    return name.replace(BASE_NAME_RE, "").trim();
  }

  private groupDeviceNames(deviceNames: string[]): string[] {
    const modelMap = new Map<string, string>();
    const baseCounts = new Map<string, number>();

    for (const name of deviceNames) {
      const baseName = this.baseDeviceName(name);
      baseCounts.set(baseName, (baseCounts.get(baseName) ?? 0) + 1);

      const existing = modelMap.get(baseName);
      if (!existing || name.length < existing.length) {
        modelMap.set(baseName, name);
      }
    }

    if (modelMap.size <= 1) return [...modelMap.values()];

    const result: string[] = [];
    for (const [baseName, count] of baseCounts) {
      if (count > 1) {
        result.push(baseName);
      } else {
        result.push(modelMap.get(baseName)!);
      }
    }

    return result.sort();
  }

  private normalizeFileName(fileName: string): string {
    const maxBaseLength = 180;
    const sanitized = fileName
      .replace(SPECIAL_CHARS_RE, "_")
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
    const match = filename.match(IPSW_PARSE_RE);
    if (!match?.groups) return null;
    return {
      id: match.groups.id,
      version: match.groups.version,
      build: match.groups.build,
    };
  }

  private async getMatchedDevicesForFile(fileId: string, fileBuild: string): Promise<MatchedDeviceInfo[]> {
    const cacheKey = `${fileId}_${fileBuild}`;
    const cached = this.deviceFirmwareCache.get(cacheKey);
    if (cached) return cached;

    await this.ensureFirmwareCacheBuilt();

    return this.deviceFirmwareCache.get(cacheKey) ?? [];
  }

  private async ensureFirmwareCacheBuilt(): Promise<void> {
    if (this.firmwareCachePromise) return this.firmwareCachePromise;

    this.firmwareCachePromise = this.buildFirmwareCache().catch((err) => {
      this.firmwareCachePromise = null;
      throw err;
    });
    return this.firmwareCachePromise;
  }

  private async buildFirmwareCache(): Promise<void> {
    const devices = this.dataHandle.getDevices();

    for (let i = 0; i < devices.length; i += MAX_CONCURRENT_LINKS) {
      const chunk = devices.slice(i, i + MAX_CONCURRENT_LINKS);
      await Promise.all(
        chunk.map(async (device) => {
          const modelData = await this.dataHandle.getModelData(device.identifier, true);
          if (!modelData || !modelData.firmwares) return;

          for (const firmware of modelData.firmwares) {
            const parsed = this.parseIPSW(firmware.url.split("/").pop() ?? "");
            if (!parsed) continue;

            const cacheKey = `${parsed.id}_${parsed.build}`;
            const entry: MatchedDeviceInfo = {
              deviceName: device.name,
              firmwareId: parsed.id,
              buildId: parsed.build,
            };

            const existing = this.deviceFirmwareCache.get(cacheKey);
            if (existing) {
              if (!existing.some((e) => e.deviceName === entry.deviceName)) {
                existing.push(entry);
              }
            } else {
              this.deviceFirmwareCache.set(cacheKey, [entry]);
            }
          }
        })
      );
    }
  }
}
