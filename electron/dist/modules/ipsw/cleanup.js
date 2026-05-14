"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPSWCleanupManager = void 0;
const promises_1 = require("fs/promises");
const path_1 = __importStar(require("path"));
class IPSWCleanupManager {
    downloader;
    dataHandle;
    config;
    constructor(downloader, dataHandle, config) {
        this.downloader = downloader;
        this.dataHandle = dataHandle;
        this.config = config;
    }
    async start() {
        const results = await Promise.all([
            this.cleanTurboFiles(),
            this.cleanTmpFiles(),
            this.config.removeOldFile || this.config.removeDuplicateFile
                ? this.cleanIPSWFiles()
                : Promise.resolve([]),
            this.config.removeInvalidFile
                ? this.cleanFileInvalid()
                : Promise.resolve([]),
        ]);
        return results.flat();
    }
    // ─── Clean core ────────────────────────────────────────────────────────────
    /** Removes orphaned .ipsw.turbo files not tied to any active download task. */
    async cleanTurboFiles() {
        return this.cleanPartialFiles(this.config.saveDir, ".ipsw.turbo", ".turbo");
    }
    /** Removes orphaned .ipsw.tmp files not tied to any active download task. */
    async cleanTmpFiles() {
        const envInfo = await this.downloader.getEnvironmentInfo(this.config.saveDir);
        const tmpDrivePath = envInfo.tmpDrive?.path;
        if (!tmpDrivePath)
            return [];
        const tmpDir = (0, path_1.join)(tmpDrivePath, "ipswManagerTmp");
        const allFiles = await this.getFiles(tmpDir, ".ipsw.tmp");
        if (allFiles.length === 0)
            return [];
        const [allTasks, incompleteTasks] = await Promise.all([
            this.downloader.getAllTask(),
            this.downloader.getIncompleteTasks(),
        ]);
        const activeIds = new Set();
        for (const t of [...allTasks, ...incompleteTasks]) {
            activeIds.add(t.id);
        }
        // Tmp files are named {taskId}.ipsw.tmp — match by task ID
        const toDelete = (activeIds.size === 0)
            ? allFiles
            : allFiles.filter(f => {
                const taskId = f.name.slice(0, -".ipsw.tmp".length);
                return !activeIds.has(taskId);
            });
        await Promise.all(toDelete.map(f => (0, promises_1.unlink)(f.path)));
        return toDelete;
    }
    /**
     * Shared logic for cleaning partial download files (.turbo / .tmp).
     * Deletes any file whose base name does not match an active or incomplete task.
     */
    async cleanPartialFiles(dir, ext, suffix) {
        const allFiles = await this.getFiles(dir, ext);
        if (allFiles.length === 0)
            return [];
        const [allTasks, incompleteTasks] = await Promise.all([
            this.downloader.getAllTask(),
            this.downloader.getIncompleteTasks(),
        ]);
        const activeFileNames = new Set();
        for (const task of [...allTasks, ...incompleteTasks]) {
            activeFileNames.add(this.getFileNameFromUrl(task.firmware.url));
        }
        const toDelete = (activeFileNames.size === 0)
            ? allFiles
            : allFiles.filter((f) => !activeFileNames.has(f.name.slice(0, -suffix.length)));
        await Promise.all(toDelete.map((f) => (0, promises_1.unlink)(f.path)));
        return toDelete;
    }
    /** Removes old-version and duplicate .ipsw files per device. */
    async cleanIPSWFiles() {
        // Collect unique product prefixes from existing files to avoid scanning all products
        const existingFiles = await this.getFiles(this.config.saveDir, ".ipsw");
        const products = [
            ...new Set(existingFiles.map((f) => this.getProductFromFileName(f.name))),
        ];
        const results = await Promise.all(products.map((product) => this.getRedundantFilesFromProduct(product)));
        const seen = new Set();
        const toDelete = [];
        for (const { oldFiles, duplicateFiles } of results) {
            if (this.config.removeOldFile) {
                for (const f of oldFiles) {
                    if (!seen.has(f.path)) {
                        seen.add(f.path);
                        toDelete.push(f);
                    }
                }
            }
            if (this.config.removeDuplicateFile) {
                for (const f of duplicateFiles) {
                    if (!seen.has(f.path)) {
                        seen.add(f.path);
                        toDelete.push(f);
                    }
                }
            }
        }
        await Promise.all(toDelete.map((f) => (0, promises_1.unlink)(f.path)));
        return toDelete.map(({ path, size, name }) => ({ path, size, name }));
    }
    async cleanFileInvalid() {
        const allFiles = await this.getFiles(this.config.saveDir, ".ipsw");
        const toDelete = [];
        for (const file of allFiles) {
            if (!this.parseIPSW(file.name) && !this.parseIPSW_Manual(file.name)) {
                toDelete.push(file);
                continue;
            }
            if (file.size === 0) {
                toDelete.push(file);
                continue;
            }
        }
        await Promise.all(toDelete.map((f) => (0, promises_1.unlink)(f.path)));
        return toDelete.map(({ path, size, name }) => ({ path, size, name }));
    }
    // ─── Redundancy detection ──────────────────────────────────────────────────
    async getRedundantFilesFromProduct(product) {
        const devices = this.dataHandle.getDevices(product);
        const results = await Promise.all(devices.map((device) => this.getRedundantFiles(device.identifier)));
        const oldSet = new Set();
        const duplicateSet = new Set();
        const oldFiles = [];
        const duplicateFiles = [];
        for (const result of results) {
            if (!result)
                continue;
            for (const f of result.oldFiles) {
                if (!oldSet.has(f.path)) {
                    oldSet.add(f.path);
                    oldFiles.push(f);
                }
            }
            for (const f of result.duplicateFiles) {
                if (!duplicateSet.has(f.path)) {
                    duplicateSet.add(f.path);
                    duplicateFiles.push(f);
                }
            }
        }
        return { oldFiles, duplicateFiles };
    }
    async getRedundantFiles(identifier) {
        const [modelData, modelFiles] = await Promise.all([
            this.dataHandle.getModelData(identifier),
            this.getIPSWFiles(identifier),
        ]);
        if (modelFiles.length === 0)
            return { oldFiles: [], duplicateFiles: [] };
        const latestFirmware = modelData?.firmwares[0];
        const latestBuildId = latestFirmware?.buildid;
        if (!latestBuildId)
            return { oldFiles: [], duplicateFiles: [] };
        const oldFiles = modelFiles.filter(({ name }) => !name.includes(latestBuildId));
        const latestFiles = modelFiles.filter(({ name }) => name.includes(latestBuildId));
        if (latestFiles.length === 0) {
            if (modelData) {
                const firmwareMap = new Map();
                for (const fw of modelData.firmwares) {
                    firmwareMap.set(fw.buildid, fw);
                }
                const signed = [];
                const notSigned = [];
                for (const file of oldFiles) {
                    const parsed = this.parseIPSW(file.name) || this.parseIPSW_Manual(file.name);
                    if (parsed) {
                        const fw = firmwareMap.get(parsed.build);
                        (fw?.signed ? signed : notSigned).push(file);
                    }
                    else {
                        notSigned.push(file);
                    }
                }
                if (signed.length > 0) {
                    const [, ...restSigned] = signed;
                    return { oldFiles: [...restSigned, ...notSigned], duplicateFiles: [] };
                }
            }
            return { oldFiles, duplicateFiles: [] };
        }
        if (latestFiles.length === 1) {
            return { oldFiles, duplicateFiles: [] };
        }
        const expectedSize = latestFirmware?.filesize;
        // Score mỗi file: 2 = đúng size + đúng format, 1 = đúng size + sai format, 0 = còn lại
        const scored = latestFiles.map((file) => {
            const sizeOk = expectedSize != null && file.size === expectedSize;
            const formatOk = this.parseIPSW(file.name) !== null;
            const score = sizeOk ? (formatOk ? 2 : 1) : 0;
            return { file, score, sizeOk, formatOk };
        });
        // Sắp xếp: score cao nhất lên đầu, tie-break theo index gốc (ổn định)
        scored.sort((a, b) => b.score - a.score);
        const [best, ...rest] = scored;
        // Nếu file tốt nhất đúng size nhưng sai format → cần rename
        let keepFile = best.file;
        if (best.sizeOk && !best.formatOk) {
            const parsed = this.parseIPSW_Manual(best.file.name);
            if (parsed) {
                const { id, version, build } = parsed;
                const newName = `${id}_${version}_${build}_Restore.ipsw`;
                keepFile = { ...best.file, name: newName };
            }
        }
        const duplicateFiles = rest.map((s) => s.file);
        return { oldFiles, duplicateFiles };
    }
    async getIPSWFiles(identifier) {
        const modelData = await this.dataHandle.getModelData(identifier);
        const lastFirmware = modelData?.firmwares[0];
        if (!lastFirmware)
            return [];
        const info = this.parseIPSW(this.getFileNameFromUrl(lastFirmware.url)) || this.parseIPSW_Manual(this.getFileNameFromUrl(lastFirmware.url));
        if (!info)
            return [];
        const buildIdSet = new Set(modelData.firmwares.map((fw) => fw.buildid));
        const allFiles = await this.getFiles(this.config.saveDir, ".ipsw");
        return allFiles.filter((file) => {
            const parsed = this.parseIPSW(file.name) || this.parseIPSW_Manual(file.name);
            return parsed?.id === info.id && buildIdSet.has(parsed.build);
        });
    }
    // ─── Utilities ─────────────────────────────────────────────────────────────
    /** Async-safe directory listing filtered by extension. */
    async getFiles(dir, ext) {
        let entries;
        try {
            entries = await (0, promises_1.readdir)(dir);
        }
        catch {
            return []; // directory may not exist (e.g. tmpDir not yet created)
        }
        const filtered = entries.filter((f) => f.endsWith(ext));
        const infos = await Promise.all(filtered.map(async (name) => {
            const filePath = path_1.default.join(dir, name);
            try {
                const { size } = await (0, promises_1.stat)(filePath);
                return { path: filePath, size, name };
            }
            catch {
                return null; // file disappeared between readdir and stat
            }
        }));
        return infos.filter((f) => f !== null);
    }
    getFileNameFromUrl(url) {
        return url.split("/").pop() ?? "";
    }
    getProductFromFileName(fileName) {
        const lower = fileName.toLowerCase();
        if (lower.startsWith("ipad"))
            return "ipad";
        if (lower.startsWith("watch"))
            return "watch";
        if (lower.startsWith("mac"))
            return "mac";
        if (lower.startsWith("realitydevice"))
            return "realitydevice";
        if (lower.startsWith("appletv"))
            return "tv";
        if (lower.startsWith("homepod") || lower.startsWith("audioaccessory"))
            return "homepod";
        if (lower.startsWith("ipod"))
            return "ipod";
        return "iphone";
    }
    parseIPSW(filename) {
        const match = filename.match(/^(?<id>.+?)_(?<version>\d+(?:\.\d+){1,3})_(?<build>[A-Za-z0-9]+)_Restore\.ipsw$/);
        if (!match?.groups)
            return null;
        const { id, version, build } = match.groups;
        return { id, version, build };
    }
    parseIPSW_Manual(fileName) {
        const nameWithoutExt = fileName.replace(".ipsw", "");
        const args = nameWithoutExt.split("_");
        ;
        if (args.length < 4)
            return null;
        const restoreIndex = args.findIndex((v) => v.toLocaleLowerCase().startsWith("restore"));
        if (restoreIndex === -1 || restoreIndex === 0)
            return null;
        const build = args[restoreIndex - 1];
        const version = args[restoreIndex - 2];
        const id = args.slice(0, restoreIndex - 2).join("_");
        return { id, version, build };
    }
}
exports.IPSWCleanupManager = IPSWCleanupManager;
