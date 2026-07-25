import { t } from "i18next";
import { ipswClient } from "../init";
import utils from "./utils";
import { downloader } from "../services/downloader";
import { data } from "../services/api";

// ─── Semaphore helper ─────────────────────────────────────────────────────────
class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private slots: number) {}

  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.slots++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

// Giới hạn 2 file delete đồng thời — IPSW rất lớn, tránh disk spike
const deleteSem = new Semaphore(2);

export function parseIPSW(filename: string): {
  id: string;
  version: string;
  build: string;
} | null {
  const regex =
    /^(?<id>.+?)_(?<version>\d+(?:\.\d+)*)_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;
  const match = filename.match(regex);
  if (!match?.groups) return null;
  return {
    id: match.groups.id,
    version: match.groups.version,
    build: match.groups.build,
  };
}

export function getFileNameFromUrl(url: Firmware["url"]): string {
  return url.split("/").pop() ?? url;
}

export async function getFiles(identifier: Device["identifier"],
): Promise<IPSWFile[]> {
  const modelData = await data.getModelData(identifier);
  if (!modelData) return [];
  const files = ipswClient.getFiles();
  const lastFirmware = modelData.firmwares[0];
  const info = parseIPSW(getFileNameFromUrl(lastFirmware.url));
  if (!info) return [];

  const buildIdMap = new Set(modelData.firmwares.map((fw) => fw.buildid));
  return files.filter((file) => {
    const parsed = parseIPSW(file.name);
    return parsed?.id === info.id && buildIdMap.has(parsed.build);
  });
}

interface RedundantFileResponse {
  oldFiles: IPSWFile[];
  duplicateFiles: IPSWFile[];
}

export async function getRedundantFiles(
  identifier: Device["identifier"],
  files?: IPSWFile[]
): Promise<RedundantFileResponse> {
  const [modelData, modelFiles] = await Promise.all([
    data.getModelData(identifier),
    files ? Promise.resolve(files) : getFiles(identifier),
  ]);
  if (!modelData) return { oldFiles: [], duplicateFiles: [] };

  if (modelFiles.length === 0) return { oldFiles: [], duplicateFiles: [] };

  const latestBuildId = modelData.firmwares[0].buildid;
  const oldFiles = modelFiles.filter(({ name }) => !name.includes(latestBuildId));
  const latestFiles = modelFiles.filter(({ name }) => name.includes(latestBuildId));
  const duplicateFiles = latestFiles.length > 1 ? latestFiles.slice(1) : [];

  return { oldFiles, duplicateFiles };
}

export async function getRedundantFilesFromProduct(
  product: Product
): Promise<RedundantFileResponse> {
  const productData = await data.getDevices(product);
  if (!productData) return { oldFiles: [], duplicateFiles: [] };
  const results = await Promise.all(
    productData.map(async (device) => {
      const files = await getFiles(device.identifier);
      if (files.length === 0) return null;
      return getRedundantFiles(device.identifier, files);
    })
  );

  const oldSet = new Set<string>();
  const duplicateSet = new Set<string>();
  const oldFiles: IPSWFile[] = [];
  const duplicateFiles: IPSWFile[] = [];

  for (const result of results) {
    if (!result) continue;
    for (const file of result.oldFiles) {
      if (!oldSet.has(file.path)) { oldSet.add(file.path); oldFiles.push(file); }
    }
    for (const file of result.duplicateFiles) {
      if (!duplicateSet.has(file.path)) { duplicateSet.add(file.path); duplicateFiles.push(file); }
    }
  }

  return { oldFiles, duplicateFiles };
}

export async function download(firmware: Firmware): Promise<{ success: boolean }> {
  try {
    utils.showSuccessMessage(t("message.downloader.sendRequest"));
    const result = await downloader.add(firmware);
    if (!result.success) {
      utils.showErrorMessage(
        t(`message.downloader.error.${result.error || "UNKNOWN"}`)
      );
    }

    return { success: result.success }
  } catch {
    utils.showErrorMessage(t(`message.downloader.error.UNKNOWN`));
  }

  return { success: false }
}

interface DeleteFileArgs {
  file?: IPSWFile;
  files?: IPSWFile[];
  identifier?: Device["identifier"];
}

export async function deleteFile({ file, files, identifier }: DeleteFileArgs) {
  if (file) return deleteSem.run(() => ipswClient.deleteFile(file));

  if (files?.length)
    return Promise.all(files.map((f) => deleteSem.run(() => ipswClient.deleteFile(f.path))));

  if (identifier) {
    const modelFiles = await getFiles(identifier);
    return Promise.all(modelFiles.map((f) => deleteSem.run(() => ipswClient.deleteFile(f.path))));
  }
}

export async function updateFirmware(
  lastFirmware: Firmware,
  redundantFiles?: RedundantFileResponse
) {
  if (redundantFiles) {
    const toDelete = [
      ...redundantFiles.oldFiles,
      ...redundantFiles.duplicateFiles,
    ];
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((file) => deleteFile({ file })));
    }
  }
  return download(lastFirmware);
}

export async function updateFirmwareOfProduct(product: Product) {
  const devices = await data.getDevices(product);
  if (!devices) return;

  // Fetch allFiles một lần cho toàn bộ product
  const allFiles = ipswClient.getFiles();

  await Promise.all(
    devices.map(async (device) => {
      const modelData = await data.getModelData(device.identifier);
      if (!modelData) return;
      const lastFirmware = modelData.firmwares[0];
      const lastFirmwareInfo = parseIPSW(getFileNameFromUrl(lastFirmware.url));

      if (!lastFirmware.signed || !lastFirmwareInfo) return;

      const buildIdMap = new Set(modelData.firmwares.map((fw) => fw.buildid));
      const deviceFiles = allFiles.filter((file) => {
        const parsed = parseIPSW(file.name);
        return parsed?.id === lastFirmwareInfo.id && buildIdMap.has(parsed.build);
      });

      if (deviceFiles.length === 0) return;
      if (deviceFiles.some((f) => f.name.includes(lastFirmware.buildid))) return;

      await updateFirmware(lastFirmware, { oldFiles: deviceFiles, duplicateFiles: [] });
    })
  );
}