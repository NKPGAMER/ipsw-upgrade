"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWHardLinkManager = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const HARD_LINK_FOLDER = "IPSW_FILES";
const MAX_CONCURRENT_LINKS = 8;
const IPSW_PARSE_RE = /^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/;
const PARENS_CONTENT_RE = /\(([^)]*)\)/g;
const SKIP_VARIANT_RE = /^(global|gsm|wifi|cellular)$/i;
const SPECIAL_CHARS_RE = /[<>:"/\\|?*\x00-\x1F]/g;
const BASE_NAME_RE = /\s*\([^)]*\)/g;
class IPSWHardLinkManager {
    watcher;
    dataHandle;
    config;
    records = new Map();
    deviceFirmwareCache = new Map();
    firmwareCachePromise = null;
    constructor(_win, watcher, dataHandle, config) {
        this.watcher = watcher;
        this.dataHandle = dataHandle;
        this.config = config;
    }
    async start() {
        await this.syncFolder();
        if (!this.config.enabled) {
            await this.stop();
            return;
        }
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
        await fs_extra_1.default.mkdir(this.folderPath, { recursive: true });
    }
    get folderPath() {
        return path_1.default.join(this.config.watchDir, this.config.outDir || HARD_LINK_FOLDER);
    }
    async rebuildFromWatcher() {
        const files = this.watcher.getFiles();
        for (let i = 0; i < files.length; i += MAX_CONCURRENT_LINKS) {
            const batch = files.slice(i, i + MAX_CONCURRENT_LINKS);
            await Promise.all(batch.map((file) => this.createLinkForFile(file)));
        }
    }
    async handleAdded(files) {
        if (!this.config.enabled)
            return;
        for (let i = 0; i < files.length; i += MAX_CONCURRENT_LINKS) {
            const batch = files.slice(i, i + MAX_CONCURRENT_LINKS);
            await Promise.all(batch.map((file) => this.createLinkForFile(file)));
        }
    }
    async handleRemoved(files) {
        if (!this.config.enabled)
            return;
        await Promise.all(files.map((file) => this.removeLinkForFile(file.path)));
    }
    async createLinkForFile(file) {
        const parsed = this.parseIPSW(file.name);
        if (!parsed)
            return;
        const sourceExists = await fs_extra_1.default.access(file.path).then(() => true).catch(() => false);
        if (!sourceExists)
            return;
        const matched = await this.getMatchedDevicesForFile(parsed.id, parsed.build);
        const deviceNames = [...new Set(matched.map((item) => item.deviceName))];
        if (!deviceNames.length)
            return;
        const fileName = this.formatLinkFileName(deviceNames, parsed.version);
        const linkPath = path_1.default.join(this.folderPath, fileName);
        if (this.records.get(file.path)?.linkPath === linkPath)
            return;
        await fs_extra_1.default.mkdir(this.folderPath, { recursive: true });
        try {
            await fs_extra_1.default.link(file.path, linkPath);
        }
        catch (error) {
            if (error?.code === "ENOENT")
                return;
            if (error?.code === "EEXIST") {
                // link already exists from another process — adopt it
            }
            else {
                console.error("[IPSWHardLinkManager] Failed to create hard link:", error?.code, error?.message);
                return;
            }
        }
        this.records.set(file.path, {
            sourcePath: file.path,
            linkPath,
            deviceNames,
            version: parsed.version,
            fileName,
        });
    }
    async removeLinkForFile(sourcePath) {
        const record = this.records.get(sourcePath);
        if (!record)
            return;
        try {
            await fs_extra_1.default.unlink(record.linkPath);
        }
        catch {
            // ignore missing link
        }
        this.records.delete(sourcePath);
    }
    async cleanupFolder() {
        const entries = await fs_extra_1.default.readdir(this.folderPath).catch(() => []);
        await Promise.all(entries.map((entry) => fs_extra_1.default.unlink(path_1.default.join(this.folderPath, entry)).catch(() => { })));
        this.records.clear();
    }
    formatLinkFileName(deviceNames, version) {
        const normalizedNames = this.normalizeDeviceNames(deviceNames);
        const groupedNames = this.groupDeviceNames(normalizedNames);
        const label = groupedNames.join(" - ");
        return this.normalizeFileName(`${label} (${version}).ipsw`);
    }
    normalizeDeviceNames(deviceNames) {
        const cleaned = deviceNames.map((name) => this.cleanDeviceName(name)).filter(Boolean);
        return [...new Set(cleaned)];
    }
    cleanDeviceName(name) {
        let result = name;
        result = result.replace(PARENS_CONTENT_RE, (_match, inner) => {
            const filtered = inner
                .split(",")
                .map((part) => part.trim())
                .filter((part) => !SKIP_VARIANT_RE.test(part));
            return filtered.length ? `(${filtered.join(", ")})` : "";
        });
        result = result.replace(/\s+/g, " ");
        result = result.replace(/\s+_/g, "_");
        result = result.replace(/_\s+/g, "_");
        result = result.replace(/\s+,/g, ",");
        result = result.replace(/,\s+/g, ", ");
        result = result.replace(/\(\s*\)/g, "");
        return result.trim();
    }
    baseDeviceName(name) {
        return name.replace(BASE_NAME_RE, "").trim();
    }
    groupDeviceNames(deviceNames) {
        const modelMap = new Map();
        const baseCounts = new Map();
        for (const name of deviceNames) {
            const baseName = this.baseDeviceName(name);
            baseCounts.set(baseName, (baseCounts.get(baseName) ?? 0) + 1);
            const existing = modelMap.get(baseName);
            if (!existing || name.length < existing.length) {
                modelMap.set(baseName, name);
            }
        }
        if (modelMap.size <= 1)
            return [...modelMap.values()];
        const result = [];
        for (const [baseName, count] of baseCounts) {
            if (count > 1) {
                result.push(baseName);
            }
            else {
                result.push(modelMap.get(baseName));
            }
        }
        return result.sort();
    }
    normalizeFileName(fileName) {
        const maxBaseLength = 180;
        const sanitized = fileName
            .replace(SPECIAL_CHARS_RE, "_")
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
        const match = filename.match(IPSW_PARSE_RE);
        if (!match?.groups)
            return null;
        return {
            id: match.groups.id,
            version: match.groups.version,
            build: match.groups.build,
        };
    }
    async getMatchedDevicesForFile(fileId, fileBuild) {
        const cacheKey = `${fileId}_${fileBuild}`;
        const cached = this.deviceFirmwareCache.get(cacheKey);
        if (cached)
            return cached;
        await this.ensureFirmwareCacheBuilt();
        return this.deviceFirmwareCache.get(cacheKey) ?? [];
    }
    async ensureFirmwareCacheBuilt() {
        if (this.firmwareCachePromise)
            return this.firmwareCachePromise;
        this.firmwareCachePromise = this.buildFirmwareCache();
        return this.firmwareCachePromise;
    }
    async buildFirmwareCache() {
        const devices = this.dataHandle.getDevices();
        for (const device of devices) {
            const modelData = await this.dataHandle.getModelData(device.identifier, true);
            if (!modelData)
                continue;
            for (const firmware of modelData.firmwares) {
                const parsed = this.parseIPSW(firmware.url.split("/").pop() ?? "");
                if (!parsed)
                    continue;
                const cacheKey = `${parsed.id}_${parsed.build}`;
                const entry = {
                    deviceName: device.name,
                    firmwareId: parsed.id,
                    buildId: parsed.build,
                };
                const existing = this.deviceFirmwareCache.get(cacheKey);
                if (existing) {
                    if (!existing.some((e) => e.deviceName === entry.deviceName)) {
                        existing.push(entry);
                    }
                }
                else {
                    this.deviceFirmwareCache.set(cacheKey, [entry]);
                }
            }
        }
    }
}
exports.IPSWHardLinkManager = IPSWHardLinkManager;
