import { getDevices, loadModelData } from "./dataHandle.js";
import utils from "./core/utils.js";

interface CleanupResult {
  device: string;
  filesDeleted: IPSWFile[];
  errors: string[];
}

interface updateData {
  device: Device;
  firmwares: Firmware[];
  latestFirmware: Firmware;
}

class FirmwareManager {
  // ── Private helpers ────────────────────────────────────────────────────────

  private async getDeviceFiles(deviceIdentifier: string) {
    const deviceData = await loadModelData(deviceIdentifier);
    const latestFirmware = deviceData.firmwares[0];
    const latestFileName = utils.getFileNameFromUrl(latestFirmware.url);
    const allFiles = await utils.findFile(latestFileName, deviceData.firmwares);
    return { latestFirmware, latestFileName, allFiles };
  }

  private filterOldFiles(allFiles: IPSWFile[], latestBuildId: string) {
    return allFiles.filter(f => !f.name.includes(latestBuildId));
  }

  private filterDuplicateFiles(allFiles: IPSWFile[], latestBuildId: string, latestFileName: string) {
    return allFiles.filter(f => f.name.includes(latestBuildId) && f.name !== latestFileName);
  }

  private filterDevices(product?: Product) {
    const devices = getDevices();
    return product
      ? devices.filter(d => d.name.toLowerCase().startsWith(product))
      : devices;
  }

  // ── Core operations ────────────────────────────────────────────────────────

  private async checkFilesForDevice(
    deviceIdentifier: string,
    filter: (allFiles: IPSWFile[], latestBuildId: string, latestFileName: string) => IPSWFile[],
    minCount = 0
  ): Promise<FileCheckResult> {
    const result: FileCheckResult = { device: deviceIdentifier, files: [], count: 0 };
    try {
      const { latestFirmware, latestFileName, allFiles } = await this.getDeviceFiles(deviceIdentifier);
      if (allFiles.length <= minCount) return result;

      const matched = filter(allFiles, latestFirmware.buildid, latestFileName);
      result.files = matched;
      result.count = matched.length;
    } catch { }
    return result;
  }

  private async deleteFilesForDevice(
    deviceIdentifier: string,
    filter: (allFiles: IPSWFile[], latestBuildId: string, latestFileName: string) => IPSWFile[],
    minCount = 0
  ): Promise<CleanupResult> {
    const result: CleanupResult = { device: deviceIdentifier, filesDeleted: [], errors: [] };
    try {
      const { latestFirmware, latestFileName, allFiles } = await this.getDeviceFiles(deviceIdentifier);
      if (allFiles.length <= minCount) return result;

      const targets = filter(allFiles, latestFirmware.buildid, latestFileName);
      await Promise.allSettled(
        targets.map(file =>
          window.api.deleteFile(file.path)
            .then(() => result.filesDeleted.push(file))
            .catch(err => result.errors.push(`Failed to delete ${file.name}: ${err}`))
        )
      );
    } catch (err) {
      result.errors.push(`Failed to process device: ${err}`);
    }
    return result;
  }

  private async runForAllDevices<T>(
    handler: (id: string) => Promise<T>,
    product?: Product
  ): Promise<T[]> {
    const devices = this.filterDevices(product);
    return Promise.all(devices.map(d => handler(d.identifier)));
  }

  public getOldFilesForDevice(id: string) {
    return this.checkFilesForDevice(id, this.filterOldFiles);
  }

  public getDuplicateFilesForDevice(id: string) {
    return this.checkFilesForDevice(id, this.filterDuplicateFiles, 1);
  }

  public deleteOldFilesForDevice(id: string) {
    return this.deleteFilesForDevice(id, this.filterOldFiles);
  }

  public deleteDuplicateFilesForDevice(id: string) {
    return this.deleteFilesForDevice(id, this.filterDuplicateFiles, 1);
  }

  public getOldFilesForAllDevices(product?: Product) {
    return this.runForAllDevices(id => this.getOldFilesForDevice(id), product);
  }

  public getDuplicateFilesForAllDevices(product?: Product) {
    return this.runForAllDevices(id => this.getDuplicateFilesForDevice(id), product);
  }

  public deleteOldFilesForAllDevices(product?: Product) {
    return this.runForAllDevices(id => this.deleteOldFilesForDevice(id), product);
  }

  public deleteDuplicateFilesForAllDevices(product?: Product) {
    return this.runForAllDevices(id => this.deleteDuplicateFilesForDevice(id), product);
  }
}

export default new FirmwareManager();