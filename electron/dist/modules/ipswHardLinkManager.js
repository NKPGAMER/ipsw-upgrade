"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWHardLinkManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const HARD_LINK_FOLDER = "IPSW_FILES";
class IPSWHardLinkManager {
    watcher;
    dataHandle;
    config;
    records = new Map();
    constructor(_win, watcher, dataHandle, config) {
        this.watcher = watcher;
        this.dataHandle = dataHandle;
        this.config = config;
    }
    async start() {
        await this.syncFolder();
        if (!this.config.enabled)
            return;
        this.watcher.onFilesAdded((files) => void this.handleAdded(files));
        this.watcher.onFilesRemoved((files) => void this.handleRemoved(files));
        await this.checkAndCreateHardLinks();
    }
    async checkAndCreateHardLinks() {
        await this.syncFolder();
        if (!this.config.enabled)
            return;
        await this.rebuildFromWatcher();
    }
    async stop() {
        await this.cleanupFolder();
    }
    async syncFolder() {
        await promises_1.default.mkdir(this.folderPath, { recursive: true });
    }
    get folderPath() {
        return path_1.default.join(this.config.watchDir, this.config.outDir || HARD_LINK_FOLDER);
    }
    async rebuildFromWatcher() {
        const files = this.watcher.getFiles();
        await Promise.all(files.map((file) => this.createLinkForFile(file)));
    }
    async handleAdded(files) {
        if (!this.config.enabled)
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
        const sourceExists = await promises_1.default.access(file.path).then(() => true).catch(() => false);
        if (!sourceExists)
            return;
        const matched = await this.getMatchedDevicesForFile(parsed.id, parsed.build);
        const deviceNames = [...new Set(matched.map((item) => item.deviceName))];
        if (!deviceNames.length)
            return;
        const record = this.buildRecord(file.path, deviceNames, parsed.version);
        const formattedLinkPath = path_1.default.join(this.folderPath, this.formatLinkFileName(deviceNames, parsed.version));
        if (this.records.get(file.path)?.linkPath === formattedLinkPath)
            return;
        await promises_1.default.mkdir(this.folderPath, { recursive: true });
        const linkExists = await promises_1.default.access(record.linkPath).then(() => true).catch(() => false);
        if (linkExists) {
            this.records.set(file.path, {
                ...record,
                linkPath: formattedLinkPath,
                fileName: path_1.default.basename(formattedLinkPath),
            });
            return;
        }
        try {
            await promises_1.default.link(file.path, record.linkPath);
            if (record.linkPath !== formattedLinkPath) {
                await promises_1.default.rename(record.linkPath, formattedLinkPath);
            }
            this.records.set(file.path, {
                ...record,
                linkPath: formattedLinkPath,
                fileName: path_1.default.basename(formattedLinkPath),
            });
        }
        catch (error) {
            console.error("[IPSWHardLinkManager] Failed to create hard link:", {
                code: error?.code,
                message: error?.message,
                stack: error?.stack,
                source: file.path,
                linkPath: record.linkPath,
                formattedLinkPath,
            });
            if (error?.code === "ENOENT")
                return;
            if (error?.code === "EEXIST") {
                this.records.set(file.path, {
                    ...record,
                    linkPath: formattedLinkPath,
                    fileName: path_1.default.basename(formattedLinkPath),
                });
            }
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
    async cleanupFolder(removeFolder = false) {
        const entries = await promises_1.default.readdir(this.folderPath).catch(() => []);
        await Promise.all(entries.map((entry) => promises_1.default.unlink(path_1.default.join(this.folderPath, entry)).catch(() => { })));
        if (removeFolder) {
            await promises_1.default.rmdir(this.folderPath).catch(() => { });
        }
        this.records.clear();
    }
    buildRecord(sourcePath, deviceNames, version) {
        const rawName = `${deviceNames.join("_").trim()}_${version}.ipsw`;
        const fileName = this.normalizeFileName(rawName);
        return {
            sourcePath,
            linkPath: path_1.default.join(this.folderPath, fileName),
            deviceNames,
            version,
            fileName,
        };
    }
    formatLinkFileName(deviceNames, version) {
        const normalizedNames = this.normalizeDeviceNames(deviceNames);
        const groupedNames = this.groupDeviceNames(normalizedNames);
        const label = groupedNames.length ? groupedNames.join(" - ") : normalizedNames.join(" - ");
        return this.normalizeFileName(`${label} (${version}).ipsw`);
    }
    normalizeDeviceNames(deviceNames) {
        const cleaned = deviceNames.map((name) => this.cleanDeviceName(name)).filter(Boolean);
        return [...new Set(cleaned)];
    }
    cleanDeviceName(name) {
        return name
            .replace(/\(([^)]*)\)/g, (_match, inner) => {
            const filtered = inner
                .split(",")
                .map((part) => part.trim())
                .filter((part) => !/^global$/i.test(part) && !/^gsm$/i.test(part) && !/^wifi$/i.test(part) && !/^cellular$/i.test(part));
            return filtered.length ? `(${filtered.join(", ")})` : "";
        })
            .replace(/\s+/g, " ")
            .replace(/\s+_/g, "_")
            .replace(/_\s+/g, "_")
            .replace(/\s+,/g, ",")
            .replace(/,\s+/g, ", ")
            .replace(/\(\s*\)/g, "")
            .trim();
    }
    groupDeviceNames(deviceNames) {
        const modelMap = new Map();
        for (const name of deviceNames) {
            const baseName = name.replace(/\s*\([^)]*\)/g, "").trim();
            const existing = modelMap.get(baseName);
            if (!existing || name.length < existing.length) {
                modelMap.set(baseName, name);
            }
        }
        const grouped = [...modelMap.values()];
        if (grouped.length <= 1)
            return grouped;
        const baseCounts = new Map();
        for (const name of deviceNames) {
            const baseName = name.replace(/\s*\([^)]*\)/g, "").trim();
            baseCounts.set(baseName, (baseCounts.get(baseName) ?? 0) + 1);
        }
        const repeatedModels = [...baseCounts.entries()].filter(([, count]) => count > 1).map(([baseName]) => baseName);
        if (!repeatedModels.length)
            return grouped;
        return [...new Set(repeatedModels)].sort();
    }
    normalizeFileName(fileName) {
        const maxBaseLength = 180;
        const sanitized = fileName
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
            .replace(/_+/g, "_")
            .trim();
        if (sanitized.length <= maxBaseLength)
            return sanitized;
        const ext = path_1.default.extname(sanitized) || ".ipsw";
        const base = path_1.default.basename(sanitized, ext);
        const shortBase = base.slice(0, Math.max(1, maxBaseLength - ext.length - 1)).replace(/_+$/g, "");
        return `${shortBase}${ext}`;
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
    async getMatchedDevicesForFile(fileId, fileBuild) {
        const devices = this.dataHandle.getDevices();
        const matched = new Map();
        for (const device of devices) {
            const modelData = await this.dataHandle.getModelData(device.identifier, true);
            if (!modelData)
                continue;
            for (const firmware of modelData.firmwares) {
                const parsed = this.parseIPSW(firmware.url.split("/").pop() ?? "");
                if (!parsed)
                    continue;
                if (parsed.id === fileId && parsed.build === fileBuild) {
                    matched.set(device.identifier, {
                        deviceName: device.name,
                        firmwareId: parsed.id,
                        buildId: parsed.build,
                    });
                    break;
                }
            }
        }
        return [...matched.values()];
    }
}
exports.IPSWHardLinkManager = IPSWHardLinkManager;
