"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWHardLinkManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const HARD_LINK_FOLDER = "IPSW_Files";
class IPSWHardLinkManager {
    watcher;
    dataHandle;
    savePath;
    enabled;
    records = new Map();
    constructor(_win, watcher, dataHandle, config) {
        this.watcher = watcher;
        this.dataHandle = dataHandle;
        this.savePath = path_1.default.resolve(config.savePath);
        this.enabled = config.enabled;
    }
    async start() {
        await this.syncFolder();
        if (!this.enabled)
            return;
        this.watcher.onFilesAdded((files) => void this.handleAdded(files));
        this.watcher.onFilesRemoved((files) => void this.handleRemoved(files));
        await this.checkAndCreateHardLinks();
    }
    async checkAndCreateHardLinks() {
        await this.syncFolder();
        if (!this.enabled)
            return;
        await this.syncHardLinks();
    }
    async updateConfig(config) {
        this.savePath = path_1.default.resolve(config.savePath);
        this.enabled = config.enabled;
        await this.syncFolder();
        if (this.enabled) {
            await this.rebuildFromWatcher();
        }
        else {
            await this.cleanupFolder();
        }
    }
    async stop() {
        await this.cleanupFolder();
    }
    async syncFolder() {
        await promises_1.default.mkdir(this.folderPath, { recursive: true });
    }
    get folderPath() {
        return path_1.default.join(this.savePath, HARD_LINK_FOLDER);
    }
    async rebuildFromWatcher() {
        const files = this.watcher.getFiles();
        await Promise.all(files.map((file) => this.createLinkForFile(file)));
    }
    async syncHardLinks() {
        const files = this.watcher.getFiles();
        const sourcePaths = new Set(files.map((file) => file.path));
        await this.cleanupOrphanLinks(sourcePaths);
        await Promise.all(files.map((file) => this.createLinkForFile(file)));
    }
    async handleAdded(files) {
        if (!this.enabled)
            return;
        await Promise.all(files.map((file) => this.createLinkForFile(file)));
    }
    async handleRemoved(files) {
        await Promise.all(files.map((file) => this.removeLinkForFile(file.path)));
    }
    async createLinkForFile(file) {
        const parsed = this.parseIPSW(file.name);
        if (!parsed)
            return;
        const deviceNames = await this.getDeviceNamesForFirmware(parsed.id);
        if (!deviceNames.length)
            return;
        const record = this.buildRecord(file.path, deviceNames, parsed.version);
        if (this.records.get(file.path)?.linkPath === record.linkPath)
            return;
        await promises_1.default.mkdir(this.folderPath, { recursive: true });
        await this.removeLinkForFile(file.path);
        try {
            await promises_1.default.link(file.path, record.linkPath);
            this.records.set(file.path, record);
        }
        catch (error) {
            console.error("[IPSWHardLinkManager] Failed to create hard link:", error);
        }
    }
    async removeLinkForFile(sourcePath) {
        const record = this.records.get(sourcePath);
        if (!record)
            return;
        try {
            await promises_1.default.unlink(record.linkPath);
        }
        catch {
            // ignore missing link
        }
        this.records.delete(sourcePath);
    }
    async cleanupFolder() {
        const entries = await promises_1.default.readdir(this.folderPath).catch(() => []);
        await Promise.all(entries.map((entry) => promises_1.default.unlink(path_1.default.join(this.folderPath, entry)).catch(() => { })));
        this.records.clear();
    }
    async cleanupOrphanLinks(activeSourcePaths) {
        const entries = await promises_1.default.readdir(this.folderPath).catch(() => []);
        const activeLinkPaths = new Set(this.records.values().map((record) => record.linkPath));
        await Promise.all(entries.map(async (entry) => {
            const linkPath = path_1.default.join(this.folderPath, entry);
            const record = [...this.records.values()].find((item) => item.linkPath === linkPath);
            if (record) {
                if (activeSourcePaths.has(record.sourcePath))
                    return;
                try {
                    await promises_1.default.unlink(linkPath);
                    this.records.delete(record.sourcePath);
                }
                catch {
                    // ignore missing or inaccessible link
                }
                return;
            }
            if (activeLinkPaths.has(linkPath))
                return;
            try {
                await promises_1.default.unlink(linkPath);
            }
            catch {
                // ignore missing or inaccessible link
            }
        }));
    }
    buildRecord(sourcePath, deviceNames, version) {
        const fileName = `${deviceNames.join("_")}_${version}.ipsw`;
        return {
            sourcePath,
            linkPath: path_1.default.join(this.folderPath, fileName),
            deviceNames,
            version,
            fileName,
        };
    }
    parseIPSW(filename) {
        const regex = /^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;
        const match = filename.match(regex);
        if (!match?.groups)
            return null;
        return {
            id: match.groups.id,
            version: match.groups.version,
            build: match.groups.build,
        };
    }
    async getDeviceNamesForFirmware(id) {
        const devices = this.dataHandle.getDevices();
        const matchedNames = new Set();
        for (const device of devices) {
            const modelData = await this.dataHandle.getModelData(device.identifier);
            if (!modelData)
                continue;
            const firmware = modelData.firmwares[0];
            if (!firmware)
                continue;
            const parsed = this.parseIPSW(firmware.url.split('/').pop() ?? '');
            if (!parsed)
                continue;
            if (parsed.id === id) {
                matchedNames.add(device.name);
            }
        }
        return [...matchedNames];
    }
}
exports.IPSWHardLinkManager = IPSWHardLinkManager;
