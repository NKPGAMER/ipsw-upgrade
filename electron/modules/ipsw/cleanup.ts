import { readdir, stat, unlink } from "fs/promises";
import path, { join } from "path";
import { DownloaderMain } from "../downloader";
import { DataHandle } from "../dataHandle";

interface CleanupConfig {
  saveDir: string;
  removeOldFile: boolean;
  removeDuplicateFile: boolean;
  removeInvalidFile: boolean;
}

interface FileInfo {
  path: string;
  size: number;
  name: string;
}

interface RedundantFileResponse {
  oldFiles: IPSWFile[];
  duplicateFiles: IPSWFile[];
}

export class IPSWCleanupManager {
  private readonly downloader: DownloaderMain;
  private readonly dataHandle: DataHandle;
  private readonly config: CleanupConfig;

  constructor(
    downloader: DownloaderMain,
    dataHandle: DataHandle,
    config: CleanupConfig,
  ) {
    this.downloader = downloader;
    this.dataHandle = dataHandle;
    this.config = config;
  }

  public async start(): Promise<FileInfo[]> {
    const results = await Promise.all([
      this.cleanTurboFiles(),
      this.cleanTmpFiles(),
      this.config.removeOldFile || this.config.removeDuplicateFile
        ? this.cleanIPSWFiles()
        : Promise.resolve([] as FileInfo[]),
    ]);
    return results.flat();
  }

  // ─── Clean core ────────────────────────────────────────────────────────────

  /** Removes orphaned .ipsw.turbo files not tied to any active download task. */
  private async cleanTurboFiles(): Promise<FileInfo[]> {
    return this.cleanPartialFiles(this.config.saveDir, ".ipsw.turbo", ".turbo");
  }

  /** Removes orphaned .ipsw.tmp files not tied to any active download task. */
  private async cleanTmpFiles(): Promise<FileInfo[]> {
    const envInfo = await this.downloader.getEnvironmentInfo(this.config.saveDir);
    const tmpDrivePath = envInfo.tmpDrive?.path;
    if (!tmpDrivePath) return [];

    const tmpDir = join(tmpDrivePath, "ipswManagerTmp");
    return this.cleanPartialFiles(tmpDir, ".ipsw.tmp", ".tmp");
  }

  /**
   * Shared logic for cleaning partial download files (.turbo / .tmp).
   * Deletes any file whose base name does not match an active or incomplete task.
   */
  private async cleanPartialFiles(
    dir: string,
    ext: string,
    suffix: string,
  ): Promise<FileInfo[]> {
    const allFiles = await this.getFiles(dir, ext);
    if (allFiles.length === 0) return [];

    const [allTasks, incompleteTasks] = await Promise.all([
      this.downloader.getAllTask(),
      this.downloader.getIncompleteTasks(),
    ]);

    const activeFileNames = new Set<string>();
    for (const task of [...allTasks, ...incompleteTasks]) {
      activeFileNames.add(this.getFileNameFromUrl(task.firmware.url));
    }

    const toDelete = (activeFileNames.size === 0)
      ? allFiles
      : allFiles.filter(
        (f) => !activeFileNames.has(f.name.slice(0, -suffix.length)),
      );

    await Promise.all(toDelete.map((f) => unlink(f.path)));
    return toDelete;
  }

  /** Removes old-version and duplicate .ipsw files per device. */
  private async cleanIPSWFiles(): Promise<FileInfo[]> {
    // Collect unique product prefixes from existing files to avoid scanning all products
    const existingFiles = await this.getFiles(this.config.saveDir, ".ipsw");
    const products = [
      ...new Set(existingFiles.map((f) => this.getProductFromFileName(f.name))),
    ] as Product[];

    const results = await Promise.all(
      products.map((product) => this.getRedundantFilesFromProduct(product)),
    );

    const seen = new Set<string>();
    const toDelete: IPSWFile[] = [];

    for (const { oldFiles, duplicateFiles } of results) {
      if (this.config.removeOldFile) {
        for (const f of oldFiles) {
          if (!seen.has(f.path)) { seen.add(f.path); toDelete.push(f); }
        }
      }
      if (this.config.removeDuplicateFile) {
        for (const f of duplicateFiles) {
          if (!seen.has(f.path)) { seen.add(f.path); toDelete.push(f); }
        }
      }
    }

    await Promise.all(toDelete.map((f) => unlink(f.path)));
    return toDelete.map(({ path, size, name }) => ({ path, size, name }));
  }

  private async cleanFileInvalid(): Promise<FileInfo[]> {
    const allFiles = await this.getFiles(this.config.saveDir, ".ipsw");
    const toDelete: IPSWFile[] = [];
    for (const file of allFiles) {
      if (!this.parseIPSW(file.name) && !this.parseIPSW_Manual(file.name)) {
        toDelete.push(file);
        continue;
      }

      if (file.size === 0) {
        toDelete.push(file);
        continue;
      }
    }
    await Promise.all(toDelete.map((f) => unlink(f.path)));
    return toDelete.map(({ path, size, name }) => ({ path, size, name }));
  }

  // ─── Redundancy detection ──────────────────────────────────────────────────

  private async getRedundantFilesFromProduct(
    product: Product,
  ): Promise<RedundantFileResponse> {
    const devices = this.dataHandle.getDevices(product);

    const results = await Promise.all(
      devices.map((device) => this.getRedundantFiles(device.identifier)),
    );

    const oldSet = new Set<string>();
    const duplicateSet = new Set<string>();
    const oldFiles: IPSWFile[] = [];
    const duplicateFiles: IPSWFile[] = [];

    for (const result of results) {
      if (!result) continue;
      for (const f of result.oldFiles) {
        if (!oldSet.has(f.path)) { oldSet.add(f.path); oldFiles.push(f); }
      }
      for (const f of result.duplicateFiles) {
        if (!duplicateSet.has(f.path)) { duplicateSet.add(f.path); duplicateFiles.push(f); }
      }
    }

    return { oldFiles, duplicateFiles };
  }

  private async getRedundantFiles(
    identifier: Device["identifier"],
    files?: IPSWFile[],
  ): Promise<RedundantFileResponse> {
    const [modelData, modelFiles] = await Promise.all([
      this.dataHandle.getModelData(identifier),
      files ? Promise.resolve(files) : this.getIPSWFiles(identifier),
    ]);

    if (modelFiles.length === 0) return { oldFiles: [], duplicateFiles: [] };

    const latestFirmware = modelData?.firmwares[0];
    const latestBuildId = latestFirmware?.buildid;
    if (!latestBuildId) return { oldFiles: [], duplicateFiles: [] };

    const oldFiles = modelFiles.filter(({ name }) => !name.includes(latestBuildId));
    const latestFiles = modelFiles.filter(({ name }) => name.includes(latestBuildId));

    if (latestFiles.length <= 1) {
      return { oldFiles, duplicateFiles: [] };
    }

    const expectedSize = latestFirmware?.filesize;

    // Score mỗi file: 2 = đúng size + đúng format, 1 = đúng size + sai format, 0 = còn lại
    const scored = latestFiles.map((file) => {
      const sizeOk = expectedSize != null && file.size === expectedSize;
      const formatOk = this.parseIPSW(file.name) !== null;
      const score = sizeOk ? (formatOk ? 2 : 1) : 0;
      return { file, score, sizeOk, formatOk };
    });

    // Sắp xếp: score cao nhất lên đầu, tie-break theo index gốc (ổn định)
    scored.sort((a, b) => b.score - a.score);

    const [best, ...rest] = scored;

    // Nếu file tốt nhất đúng size nhưng sai format → cần rename
    let keepFile = best.file;

    if (best.sizeOk && !best.formatOk) {
      const parsed = this.parseIPSW_Manual(best.file.name);
      if (parsed) {
        const { id, version, build } = parsed;
        const newName = `${id}_${version}_${build}_Restore.ipsw`;
        keepFile = { ...best.file, name: newName };
      }
    }

    const duplicateFiles = rest.map((s) => s.file);

    return { oldFiles, duplicateFiles };
  }

  async getIPSWFiles(identifier: Device["identifier"]): Promise<IPSWFile[]> {
    const modelData = await this.dataHandle.getModelData(identifier);
    const lastFirmware = modelData?.firmwares[0];
    if (!lastFirmware) return [];

    const info = this.parseIPSW(this.getFileNameFromUrl(lastFirmware.url)) || this.parseIPSW_Manual(this.getFileNameFromUrl(lastFirmware.url));
    if (!info) return [];

    const buildIdSet = new Set(modelData!.firmwares.map((fw) => fw.buildid));
    const allFiles = await this.getFiles(this.config.saveDir, ".ipsw");

    return allFiles.filter((file) => {
      const parsed = this.parseIPSW(file.name) || this.parseIPSW_Manual(file.name);
      return parsed?.id === info.id && buildIdSet.has(parsed.build);
    });
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  /** Async-safe directory listing filtered by extension. */
  private async getFiles(dir: string, ext: string): Promise<FileInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return []; // directory may not exist (e.g. tmpDir not yet created)
    }

    const filtered = entries.filter((f) => f.endsWith(ext));
    const infos = await Promise.all(
      filtered.map(async (name): Promise<FileInfo | null> => {
        const filePath = path.join(dir, name);
        try {
          const { size } = await stat(filePath);
          return { path: filePath, size, name };
        } catch {
          return null; // file disappeared between readdir and stat
        }
      }),
    );
    return infos.filter((f): f is FileInfo => f !== null);
  }

  private getFileNameFromUrl(url: string): string {
    return url.split("/").pop() ?? "";
  }

  private getProductFromFileName(fileName: string): Product {
    const lower = fileName.toLowerCase();
    if (lower.startsWith("ipad")) return "ipad";
    if (lower.startsWith("watch")) return "watch";
    if (lower.startsWith("mac")) return "mac";
    if (lower.startsWith("realitydevice")) return "realitydevice";
    if (lower.startsWith("appletv")) return "tv";
    if (lower.startsWith("homepod") || lower.startsWith("audioaccessory")) return "homepod";
    if (lower.startsWith("ipod")) return "ipod";
    return "iphone";
  }

  private parseIPSW(filename: string): { id: string; version: string; build: string } | null {
    const match = filename.match(
      /^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/,
    );
    if (!match?.groups) return null;
    const { id, version, build } = match.groups;
    return { id, version, build };
  }

  private parseIPSW_Manual(fileName: string): {
    id: string;
    version: string;
    build: string;
  } | null {
    const nameWithoutExt = fileName.replace(".ipsw", "");
    const args = nameWithoutExt.split("_");;

    if (args.length < 4) return null;

    const restoreIndex = args.findIndex((v) => v.toLocaleLowerCase().startsWith("restore"));
    if (restoreIndex === -1 || restoreIndex === 0) return null;

    const build = args[restoreIndex - 1];
    const version = args[restoreIndex - 2];
    const id = args.slice(0, restoreIndex - 2).join("_");

    return { id, version, build };
  }
}