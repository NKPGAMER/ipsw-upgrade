"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataHandle = void 0;
const config_1 = __importDefault(require("../config"));
const userData_1 = require("./userData");
// ─── Constants ────────────────────────────────────────────────────────────────
const FILES = {
    metadata: "metadata.json",
    devices: "devices.json",
};
const API = {
    devices: "https://api.ipsw.me/v4/devices",
    getFirmware: "https://api.ipsw.me/v4/device/{{id}}?type=ipsw",
    releases: "https://api.ipsw.me/v4/releases",
};
const METADATA_RELEASE_KEY = "lastRelease";
// ─── Metadata helper ──────────────────────────────────────────────────────────
const metadata = new class {
    parse(raw) {
        if (!raw)
            return {};
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    async read(key) {
        const raw = await (0, userData_1.read)(FILES.metadata);
        const data = this.parse(raw);
        if (key === undefined)
            return data;
        return data[key] ?? null;
    }
    async write(data) {
        try {
            await (0, userData_1.write)(FILES.metadata, JSON.stringify(data, null, 2));
            return true;
        }
        catch (error) {
            console.error("[metadata] Failed to write:", error);
            return false;
        }
    }
    async update(patch) {
        const current = await this.read();
        return this.write({ ...current, ...patch });
    }
};
// ─── DataHandle ───────────────────────────────────────────────────────────────
class DataHandle {
    latestRelease;
    devices = [];
    modelMap = new Map();
    win;
    // Queue: prevents API spam when multiple identifiers are requested at once
    fetchQueue = [];
    fetchActive = false;
    constructor(window) {
        this.win = window;
    }
    // ── IPC ────────────────────────────────────────────────────────────────────
    sendEvent(channel, ...args) {
        if (this.win && !this.win.isDestroyed()) {
            this.win.webContents.send(`dh:${channel}`, ...args);
        }
    }
    // ── Queue ──────────────────────────────────────────────────────────────────
    enqueue(task) {
        this.fetchQueue.push(task);
        this.drainQueue();
    }
    async drainQueue() {
        if (this.fetchActive)
            return;
        this.fetchActive = true;
        while (this.fetchQueue.length > 0) {
            const task = this.fetchQueue.shift();
            try {
                await task();
            }
            catch (err) {
                console.error("[DataHandle] Queue task error:", err);
            }
        }
        this.fetchActive = false;
    }
    // ── Release ────────────────────────────────────────────────────────────────
    async getLatestRelease() {
        if (this.latestRelease)
            return this.latestRelease;
        const response = await fetch(API.releases);
        if (response.status !== 200)
            throw new Error(`Failed to fetch releases: ${response.status}`);
        const data = await response.json();
        const latestDate = data[0].date;
        this.latestRelease = latestDate;
        await metadata.update({ [METADATA_RELEASE_KEY]: latestDate });
        return latestDate;
    }
    async invalidateReleaseCache() {
        this.latestRelease = undefined;
        const current = await metadata.read();
        const { [METADATA_RELEASE_KEY]: _, ...rest } = current;
        await metadata.write(rest);
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    shouldUpdate(storedRelease, latestRelease) {
        return storedRelease !== latestRelease;
    }
    getProductType(identifier) {
        const lower = identifier.toLowerCase();
        if (lower.startsWith("iphone"))
            return "iphone";
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
        if (lower.startsWith("homepod")
            || lower.startsWith("audioaccessory"))
            return "homepod";
        if (lower.startsWith("ipod"))
            return "ipod";
        return undefined;
    }
    async validateOrDeleteFile(filePath, stored) {
        if (!stored.dataHandleVersion || stored.dataHandleVersion !== config_1.default.DataVersion) {
            await (0, userData_1.deleteFile)(filePath);
            return false;
        }
        return true;
    }
    // ── Devices ────────────────────────────────────────────────────────────────
    async loadDevices() {
        try {
            const stored = await (0, userData_1.read)(FILES.devices);
            if (stored) {
                const data = JSON.parse(stored);
                const isValid = await this.validateOrDeleteFile(FILES.devices, data);
                if (isValid) {
                    const latestRelease = await this.getLatestRelease();
                    if (!this.shouldUpdate(data.lastRelease, latestRelease)) {
                        this.devices = data.devices;
                        return;
                    }
                }
            }
        }
        catch {
            await (0, userData_1.deleteFile)(FILES.devices);
        }
        await this.loadDevicesFromAPI();
    }
    async loadDevicesFromAPI() {
        try {
            const [deviceResponse, latestRelease] = await Promise.all([
                fetch(API.devices),
                this.getLatestRelease(),
            ]);
            if (deviceResponse.status !== 200)
                throw new Error(`Failed to fetch devices: ${deviceResponse.status}`);
            this.devices = await deviceResponse.json();
            (0, userData_1.write)(FILES.devices, JSON.stringify({
                dataHandleVersion: config_1.default.DataVersion,
                lastRelease: latestRelease,
                devices: this.devices,
            })).catch(err => console.error("[DataHandle] Failed to write devices:", err));
        }
        catch {
            const stored = await (0, userData_1.read)(FILES.devices);
            if (stored) {
                const data = JSON.parse(stored);
                this.devices = data.devices;
            }
        }
    }
    getDevices(product) {
        return product
            ? this.devices.filter(device => device.identifier.toLocaleLowerCase().startsWith(product))
            : this.devices;
    }
    // ── Model data (main process, returns promise) ─────────────────────────────
    async getModelData(identifier) {
        const product = this.getProductType(identifier);
        if (!product)
            return;
        const latestRelease = await this.getLatestRelease();
        if (this.modelMap.has(identifier))
            return this.modelMap.get(identifier).device;
        const file = `products/${product}/${identifier}.json`;
        try {
            const stored = await (0, userData_1.read)(file);
            if (stored) {
                const data = JSON.parse(stored);
                const isValid = await this.validateOrDeleteFile(file, data);
                if (isValid && !this.shouldUpdate(data.lastRelease, latestRelease)) {
                    this.modelMap.set(identifier, data);
                    return data.device;
                }
            }
        }
        catch {
            await (0, userData_1.deleteFile)(file);
        }
        return this.getModelDataFromAPI(identifier, product, latestRelease, file);
    }
    async getModelDataFromAPI(identifier, product, latestRelease, file) {
        const response = await fetch(API.getFirmware.replace("{{id}}", identifier));
        if (response.status !== 200)
            return;
        const deviceData = await response.json();
        const modelData = {
            dataHandleVersion: config_1.default.DataVersion,
            lastRelease: latestRelease,
            device: deviceData,
        };
        this.modelMap.set(identifier, modelData);
        (0, userData_1.write)(file, JSON.stringify(modelData)).catch(err => console.error("[DataHandle] Failed to write model data:", err));
        return deviceData;
    }
    // ── Model data for React renderer (fire-and-forget with IPC callback) ──────
    //
    // Usage in renderer: ipcRenderer.on("dh:modelData", (_, id, data) => ...)
    // Call:              ipcMain.handle("dh:getModelDataForReact", (_, id) => dh.getModelDataForReact(id))
    //
    // Flow:
    //   1. Returns empty data immediately so React can render a skeleton.
    //   2. Queues the real fetch (serialised – no API spam).
    //   3. Once resolved, sends { id, device } back via "dh:modelData" IPC event.
    getModelDataForReact(identifier) {
        // Immediately send empty payload so renderer can show skeleton/loading state
        this.sendEvent("modelData", identifier, null);
        this.enqueue(async () => {
            const product = this.getProductType(identifier);
            if (!product) {
                this.sendEvent("modelData", identifier, null);
                return;
            }
            // Cache hit – send right away without hitting the network
            if (this.modelMap.has(identifier)) {
                this.sendEvent("modelData", identifier, this.modelMap.get(identifier).device);
                return;
            }
            const device = await this.getModelData(identifier);
            this.sendEvent("modelData", identifier, device ?? null);
        });
    }
}
exports.DataHandle = DataHandle;
