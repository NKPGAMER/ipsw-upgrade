import { t } from "i18next";
import { state } from "../data";
import { ipswClient } from "../init";
import utils from "./utils";
import { downloader } from "./downloader";
import { commands, type DeviceWithIpsws, type Product, type BaseDevice } from "@/bind";

export async function waitReady<T>(
  fn: () => Promise<any>,
  interval = 300
): Promise<T> {
  while (true) {
    const r = await fn();

    if (r.status === "error") {
      throw r.error;
    }

    if (r.data.status === "ready") {
      return r.data as T;
    }

    await new Promise(resolve =>
      setTimeout(resolve, interval)
    );
  }
}

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
  const modelData = await waitReady<DeviceWithIpsws>(() => commands.getModelData(identifier));
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
    waitReady<DeviceWithIpsws>(() => commands.getModelData(identifier)),
    files ? Promise.resolve(files) : getFiles(identifier),
  ]);

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
  const productData = await waitReady<BaseDevice[]>(() => commands.getDevices(product));
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
    const filename = getFileNameFromUrl(firmware.url);
    const savePath = [state.currentFolder.replace(/[\\/]+$/, ""), filename].join("\\");
    utils.showSuccessMessage(t("message.downloader.sendRequest"));
    const result = await downloader.add(firmware, savePath);
    if (!result.success) {
      utils.showErrorMessage(
        t(`message.downloader.error.${result.error?.error || "UNKNOWN"}` as any)
      );
    }

    return { success: result.success }
  } catch(error) {
    utils.showErrorMessage(t(`message.downloader.error.UNKNOWN`));
    console.log(error);
  }

  return { success: false }
}

interface DeleteFileArgs {
  file?: IPSWFile;
  files?: IPSWFile[];
  identifier?: Device["identifier"];
}

export async function deleteFile({ file, files, identifier }: DeleteFileArgs) {
  const f: IPSWFile[] =
    file
      ? [file]
      : files
        ? files
        : identifier
          ? await getFiles(identifier)
          : []
    ;

  return await ipswClient.deleteFile(f);
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
  const devices = await waitReady<BaseDevice[]>(() => commands.getDevices(product));

  // Fetch allFiles một lần cho toàn bộ product
  const allFiles = ipswClient.getFiles();

  await Promise.all(
    devices.map(async ({ identifier }) => {
      const modelData = await waitReady<DeviceWithIpsws>(() => commands.getModelData(identifier));
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