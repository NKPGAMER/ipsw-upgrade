import { getDevices, loadModelData } from "./dataHandle.js";
import utils from "./core/utils.js";
class FirmwareManager {
    // ── Private helpers ────────────────────────────────────────────────────────
    async getDeviceFiles(deviceIdentifier) {
        const deviceData = await loadModelData(deviceIdentifier);
        const latestFirmware = deviceData.firmwares[0];
        const latestFileName = utils.getFileNameFromUrl(latestFirmware.url);
        const allFiles = await utils.findFile(latestFileName, deviceData.firmwares);
        return { latestFirmware, latestFileName, allFiles };
    }
    filterOldFiles(allFiles, latestBuildId) {
        return allFiles.filter(f => !f.name.includes(latestBuildId));
    }
    filterDuplicateFiles(allFiles, latestBuildId, latestFileName) {
        return allFiles.filter(f => f.name.includes(latestBuildId) && f.name !== latestFileName);
    }
    filterDevices(product) {
        const devices = getDevices();
        return product
            ? devices.filter(d => d.name.toLowerCase().startsWith(product))
            : devices;
    }
    // ── Core operations ────────────────────────────────────────────────────────
    async checkFilesForDevice(deviceIdentifier, filter, minCount = 0) {
        const result = { device: deviceIdentifier, files: [], count: 0 };
        try {
            const { latestFirmware, latestFileName, allFiles } = await this.getDeviceFiles(deviceIdentifier);
            if (allFiles.length <= minCount)
                return result;
            const matched = filter(allFiles, latestFirmware.buildid, latestFileName);
            result.files = matched;
            result.count = matched.length;
        }
        catch { }
        return result;
    }
    async deleteFilesForDevice(deviceIdentifier, filter, minCount = 0) {
        const result = { device: deviceIdentifier, filesDeleted: [], errors: [] };
        try {
            const { latestFirmware, latestFileName, allFiles } = await this.getDeviceFiles(deviceIdentifier);
            if (allFiles.length <= minCount)
                return result;
            const targets = filter(allFiles, latestFirmware.buildid, latestFileName);
            await Promise.allSettled(targets.map(file => window.api.deleteFile(file.path)
                .then(() => result.filesDeleted.push(file))
                .catch(err => result.errors.push(`Failed to delete ${file.name}: ${err}`))));
        }
        catch (err) {
            result.errors.push(`Failed to process device: ${err}`);
        }
        return result;
    }
    async runForAllDevices(handler, product) {
        const devices = this.filterDevices(product);
        return Promise.all(devices.map(d => handler(d.identifier)));
    }
    getOldFilesForDevice(id) {
        return this.checkFilesForDevice(id, this.filterOldFiles);
    }
    getDuplicateFilesForDevice(id) {
        return this.checkFilesForDevice(id, this.filterDuplicateFiles, 1);
    }
    deleteOldFilesForDevice(id) {
        return this.deleteFilesForDevice(id, this.filterOldFiles);
    }
    deleteDuplicateFilesForDevice(id) {
        return this.deleteFilesForDevice(id, this.filterDuplicateFiles, 1);
    }
    getOldFilesForAllDevices(product) {
        return this.runForAllDevices(id => this.getOldFilesForDevice(id), product);
    }
    getDuplicateFilesForAllDevices(product) {
        return this.runForAllDevices(id => this.getDuplicateFilesForDevice(id), product);
    }
    deleteOldFilesForAllDevices(product) {
        return this.runForAllDevices(id => this.deleteOldFilesForDevice(id), product);
    }
    deleteDuplicateFilesForAllDevices(product) {
        return this.runForAllDevices(id => this.deleteDuplicateFilesForDevice(id), product);
    }
}
export default new FirmwareManager();
