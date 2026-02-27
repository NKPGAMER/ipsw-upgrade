import { getDevices, loadModelData } from "./dataHandle.js";
import utils from "./core/utils.js";

interface CleanupResult {
  device: string;
  filesDeleted: IPSWFile[];
  errors: string[];
}

interface updateData {
  device: Device,
  firmwares: Firmware[],
  latestFirmware: Firmware
}


class FirmwareManager {
  constructor() {}

  // Xóa tất cả tệp cũ của một device (giữ lại phiên bản mới nhất)
  public async deleteOldFilesForDevice(deviceIdentifier: string): Promise<CleanupResult> {
    const result: CleanupResult = {
      device: deviceIdentifier,
      filesDeleted: [],
      errors: []
    };

    try {
      const deviceData = await loadModelData(deviceIdentifier);
      const latestFirmware = deviceData.firmwares[0]
      const latestFileName = utils.getFileNameFromUrl(latestFirmware.url);
      const deviceFiles = await utils.findFile(latestFileName, deviceData.firmwares);

      if (deviceFiles.length === 0) return result;
      const oldFiles = deviceFiles.filter(f => !f.name.includes(latestFirmware.buildid));

      for (const file of oldFiles) {
        try {
          await window.api.deleteFile(file.path);
          result.filesDeleted.push(file);
        } catch (error) {
          result.errors.push(`Failed to delete ${file.name}: ${error}`);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to process device: ${error}`);
    }

    return result;
  }

  // Xóa tất cả tệp trùng lặp của một device (giữ lại một bản duy nhất của mỗi phiên bản)
  public async deleteDuplicateFilesForDevice(deviceIdentifier: string): Promise<CleanupResult> {
    const result: CleanupResult = {
      device: deviceIdentifier,
      filesDeleted: [],
      errors: []
    };

    try {
      const deviceData = await loadModelData(deviceIdentifier);
      const latestFirmware = deviceData.firmwares[0]
      const latestFileName = utils.getFileNameFromUrl(latestFirmware.url);
      const deviceFiles = await utils.findFile(latestFileName, deviceData.firmwares);

      if (deviceFiles.length <= 1) return result;
      const duplicateFiles = deviceFiles.filter(f => f.name.includes(latestFirmware.buildid) && f.name !== latestFileName);

      if (duplicateFiles.length === 0) return result;

      for (const file of duplicateFiles) {
        try {
          await window.api.deleteFile(file.path);
          result.filesDeleted.push(file);
        } catch (error) {
          result.errors.push(`Failed to delete ${file.name}: ${error}`);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to process device: ${error}`);
    }

    return result;
  }

  // Xóa tất cả tệp cũ của tất cả device
  public async deleteOldFilesForAllDevices(product?: Product): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    let devices = getDevices();

    if (product) {
      devices = devices.filter(d => d.name.toLowerCase().startsWith(product));
    }

    for (const device of devices) {
      const result = await this.deleteOldFilesForDevice(device.identifier);
      results.push(result);
    }

    return results;
  }

  // Xóa tất cả tệp trùng lặp của tất cả device
  public async deleteDuplicateFilesForAllDevices(product?: Product): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    let devices = getDevices();

    if (product) {
      devices = devices.filter(d => d.name.toLowerCase().startsWith(product));
    }

    for (const device of devices) {
      const result = await this.deleteDuplicateFilesForDevice(device.identifier);
      results.push(result);
    }

    return results;
  }
} 

export default new FirmwareManager();