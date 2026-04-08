import { t } from "i18next";
import { state } from "../data";
import { loadModelData, getDevicesByProduct } from "./dataHandle";
import utils from "./utils";

export function parseIPSW(filename: string): {
  id: string,
  version: string,
  build: string
} | null {
  const regex = /^(?<id>.+?)_(?<version>\d+(?:\.\d+)*)_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;

  const match = filename.match(regex);
  if (!match || !match.groups) return null;

  return {
    id: match.groups.id,
    version: match.groups.version,
    build: match.groups.build,
  };
}

export function getFileNameFromUrl(url: Firmware["url"]): string {
  return url.split("/").pop() ?? url;
}

export async function getFiles(identifier: Device['identifier']) {
  const [modelData, allFiles] = await Promise.all([
    loadModelData(identifier),
    window.api.getFiles(state.currentFolder)
  ]);
  const lastFirmware = modelData.firmwares[0];
  const info = parseIPSW(getFileNameFromUrl(lastFirmware.url));

  if (!info) return [];
  const buildIdMap = new Set(modelData.firmwares.map(fw => fw.buildid));
  
  return allFiles.filter(file => {
    const parsed = parseIPSW(file.name)
    return parsed?.id === info.id && buildIdMap.has(parsed.build)
  });
}

export async function getRedundantFiles(identifier: Device["identifier"], files?: IPSWFile[]): Promise<{
  oldFiles: IPSWFile[];
  duplicateFiles: IPSWFile[];
}> {
  const modelData = await loadModelData(identifier);
  const modelFiles = files ?? await getFiles(identifier);
  if (modelFiles.length === 0) return {
    oldFiles: [],
    duplicateFiles: []
  };

  const latestFirmware = modelData.firmwares[0];
  const oldFiles = modelFiles.filter(({ name }) => !name.includes(latestFirmware.buildid));
  const latestFiles = modelFiles.filter(({ name }) => name.includes(latestFirmware.buildid))
  const duplicateFiles = latestFiles.length > 1 ? latestFiles.slice(1) : [];

  return { oldFiles, duplicateFiles };
};

export async function getRedundantFilesFromProduct(product: Product): Promise<{
  oldFiles: IPSWFile[];
  duplicateFiles: IPSWFile[];
}> {
  const productData = getDevicesByProduct(product);

  const oldFiles: IPSWFile[] = [];
  const duplicateFiles: IPSWFile[] = [];
  const oldSet = new Set<string>();
  const duplicateSet = new Set<string>();

  for (const device of productData) {
    const files = await getFiles(device.identifier);

    if (files.length === 0) continue;

    const { oldFiles: oFiles, duplicateFiles: dFiles } =
      await getRedundantFiles(device.identifier, files);

    for (const file of oFiles) {
      if (!oldSet.has(file.path)) {
        oldSet.add(file.path);
        oldFiles.push(file);
      }
    }

    for (const file of dFiles) {
      if (!duplicateSet.has(file.path)) {
        duplicateSet.add(file.path);
        duplicateFiles.push(file);
      }
    }
  }

  return {
    oldFiles,
    duplicateFiles,
  };
}

export async function download(firmware: Firmware) {
  try {
    utils.showSuccessMessage(t('message.downloader.sendRequest'))
    const result = await window.downloader.add(firmware, state.currentFolder);

    if (!result.success) {
      utils.showErrorMessage(t(`message.downloader.error.${result.error || 'UNKNOWN'}`));
    } else {
      utils.showSuccessMessage(t('message.downloader.start'))
    }
  } catch (error) {

  }
}

interface DeleteFileArgs {
  file?: IPSWFile;
  files?: IPSWFile[];
  identifier?: Device["identifier"];
  latest?: boolean;
};

export async function deleteFile({ file, files, identifier }: DeleteFileArgs) {
  if (file) {
    return await window.api.deleteFile(file.path)
  };

  if (files) {
    return await Promise.all(files.map((file => window.api.deleteFile(file.path))))
  };

  if (identifier) {
    const modelFiles = await getFiles(identifier);
    return await Promise.all(modelFiles.map((file => window.api.deleteFile(file.path))))
  }
}