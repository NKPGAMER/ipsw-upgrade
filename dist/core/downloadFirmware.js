import { state } from "../data.js";
import utils from "./utils.js";
class downloadFirmware {
    constructor() {
        this.minFreeSpace = 5 * 1024 * 1024 * 1024; // 5GB
    }
    async download(firmware, device, options) {
        try {
            const { available } = await window.api.getDiskSpace(state.currentFolder);
            if (available - firmware.filesize <= this.minFreeSpace) {
                return {
                    result: 'diskFull',
                    reason: `${utils.formatBytes(this.minFreeSpace + firmware.filesize)}`
                };
            }
            const downloadRequest = this.createDownloadRequest(firmware, device);
            if (options?.continue) {
                downloadRequest.continue = true;
            }
            const result = await window.downloader.download(downloadRequest, {
                useIDM: state.useIDM,
                IDMPath: state.IDMPath
            });
            if (result === 'already-downloading') {
                return {
                    result: 'error',
                    reason: `Tệp ${downloadRequest.fileName} đang được tải xuống`
                };
            }
            return {
                result: 'success'
            };
        }
        catch (error) {
            return {
                result: 'error',
                reason: error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định'
            };
        }
    }
    createDownloadRequest(firmware, device) {
        return {
            fileName: utils.getFileNameFromUrl(firmware.url),
            path: state.currentFolder,
            device: device,
            firmware: firmware,
            priority: true
        };
    }
}
export default new downloadFirmware();
