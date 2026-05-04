"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataHandle = void 0;
const electron_1 = require("electron");
const config_1 = __importDefault(require("../config"));
const userData_1 = require("./userData");
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
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
// Queue & cache tuning
const { cacheTtlMs: TTL_MS, maxConcurrentFetches: MAX_CONCURRENT, requestDelayMs: REQUEST_DELAY_MS, maxRetries: MAX_RETRIES, retryBaseDelayMs: RETRY_BASE_DELAY_MS, } = config_1.default;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
    DATA_DIR = path_1.default.join(electron_1.app.getPath("userData"), "ipswData");
    FILES = {
        metadata: path_1.default.join(this.DATA_DIR, FILES.metadata),
        devices: path_1.default.join(this.DATA_DIR, FILES.devices),
        products: path_1.default.join(this.DATA_DIR, "products"),
    };
    latestRelease;
    devices = [];
    modelMap = new Map();
    win;
    // Concurrent queue: dedup + rate-limit + retry
    pendingIds = new Set();
    activeFetchCount = 0;
    constructor(window) {
        this.win = window;
        fs_extra_1.default.ensureDir(this.DATA_DIR);
        fs_extra_1.default.ensureDir(this.FILES.products);
    }
    // ── IPC ────────────────────────────────────────────────────────────────────
    sendEvent(channel, ...args) {
        if (this.win && !this.win.isDestroyed()) {
            this.win.webContents.send(`dh:${channel}`, ...args);
        }
    }
    // ── Queue (concurrent + dedup + retry) ────────────────────────────────────
    async fetchWithRetry(url) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(url);
                if (res.status === 429) {
                    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0");
                    const delay = Math.max(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), retryAfter * 1000);
                    if (attempt < MAX_RETRIES) {
                        await sleep(delay);
                        continue;
                    }
                }
                return res;
            }
            catch {
                if (attempt < MAX_RETRIES) {
                    await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
                    continue;
                }
                throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${url}`);
            }
        }
        throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${url}`);
    }
    async readStoredModelData(file) {
        try {
            const stored = await (0, userData_1.read)(file);
            if (!stored)
                return null;
            const data = JSON.parse(stored);
            if (data.cachedAt == null)
                data.cachedAt = 0;
            return data;
        }
        catch {
            return null;
        }
    }
    async readStoredDevices() {
        try {
            const stored = await (0, userData_1.read)(FILES.devices);
            if (!stored)
                return null;
            return JSON.parse(stored);
        }
        catch {
            return null;
        }
    }
    async readStoredRelease() {
        try {
            const stored = await metadata.read(METADATA_RELEASE_KEY);
            return stored ?? null;
        }
        catch {
            return null;
        }
    }
    scheduleFetch(identifier, _product, file) {
        if (this.pendingIds.has(identifier))
            return;
        this.pendingIds.add(identifier);
        this.drainQueue(identifier, file);
    }
    async drainQueue(identifier, file) {
        // Wait if at concurrency limit
        while (this.activeFetchCount >= MAX_CONCURRENT) {
            await sleep(50);
        }
        this.activeFetchCount++;
        try {
            // Delay between starting requests
            await sleep(REQUEST_DELAY_MS);
            let latestRelease = "";
            try {
                latestRelease = await this.getLatestRelease();
            }
            catch (error) {
                console.error("[DataHandle] latestRelease fetch failed in queue:", error);
                latestRelease = (await this.readStoredRelease()) ?? "";
            }
            // Check file cache again (might have been populated while waiting)
            try {
                const stored = await (0, userData_1.read)(file);
                if (stored) {
                    const data = JSON.parse(stored);
                    if (data.cachedAt == null)
                        data.cachedAt = 0;
                    const isValid = await this.validateOrDeleteFile(file, data);
                    if (isValid && !this.shouldUpdate(data.lastRelease, latestRelease)) {
                        this.modelMap.set(identifier, data);
                        this.pendingIds.delete(identifier);
                        this.activeFetchCount--;
                        this.sendEvent("deviceDataUpdated", { identifier, data: data.device });
                        this.sendEvent("modelData", identifier, data.device);
                        return;
                    }
                }
            }
            catch { /* proceed to API */ }
            const url = API.getFirmware.replace("{{id}}", identifier);
            const response = await this.fetchWithRetry(url);
            if (response.status !== 200) {
                this.pendingIds.delete(identifier);
                this.activeFetchCount--;
                console.error("[DataHandle] fetch failed status:", response.status, identifier);
                return;
            }
            const deviceData = await response.json();
            const modelData = {
                dataHandleVersion: config_1.default.DataVersion,
                lastRelease: latestRelease,
                device: deviceData,
                cachedAt: Date.now(),
            };
            this.modelMap.set(identifier, modelData);
            (0, userData_1.write)(file, JSON.stringify(modelData)).catch(err => console.error("[DataHandle] Failed to write model data:", err));
            this.sendEvent("deviceDataUpdated", { identifier, data: deviceData });
            this.sendEvent("modelData", identifier, deviceData);
        }
        catch (err) {
            console.error("[DataHandle] drainQueue failed:", identifier, err);
        }
        finally {
            this.pendingIds.delete(identifier);
            this.activeFetchCount--;
        }
    }
    // ── Release ────────────────────────────────────────────────────────────────
    async getLatestRelease() {
        if (this.latestRelease)
            return this.latestRelease;
        const response = await fetch(API.releases);
        if (response.status === 429) {
            const localRelease = await this.readStoredRelease();
            if (localRelease) {
                this.latestRelease = localRelease;
                return localRelease;
            }
            throw new Error(`Failed to fetch releases: ${response.status}`);
        }
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
        console.log("[DataHandle] loadDevices() start");
        try {
            const stored = await this.readStoredDevices();
            console.log("[DataHandle] loadDevices() stored file:", stored ? "hit" : "miss");
            if (stored) {
                const isValid = await this.validateOrDeleteFile(FILES.devices, stored);
                console.log("[DataHandle] loadDevices() cache version valid:", isValid, "storedRelease:", stored.lastRelease);
                if (isValid) {
                    let latestRelease = "";
                    try {
                        latestRelease = await this.getLatestRelease();
                    }
                    catch (error) {
                        console.error("[DataHandle] loadDevices() latestRelease fetch failed:", error);
                        latestRelease = (await this.readStoredRelease()) ?? "";
                    }
                    console.log("[DataHandle] loadDevices() latestRelease:", latestRelease);
                    if (!latestRelease || !this.shouldUpdate(stored.lastRelease, latestRelease)) {
                        this.devices = stored.devices;
                        console.log("[DataHandle] loadDevices() using cached devices:", this.devices.length);
                        return;
                    }
                    console.log("[DataHandle] loadDevices() cache stale, refreshing from API");
                }
            }
        }
        catch (error) {
            console.error("[DataHandle] loadDevices() cache read failed:", error);
            await (0, userData_1.deleteFile)(FILES.devices);
        }
        await this.loadDevicesFromAPI();
    }
    async loadDevicesFromAPI() {
        console.log("[DataHandle] loadDevicesFromAPI() start");
        const [deviceResponse, latestRelease] = await Promise.all([
            fetch(API.devices),
            this.getLatestRelease(),
        ]);
        console.log("[DataHandle] loadDevicesFromAPI() response status:", deviceResponse.status, "latestRelease:", latestRelease);
        if (deviceResponse.status === 429) {
            const stored = await this.readStoredDevices();
            if (stored) {
                this.devices = stored.devices;
                console.log("[DataHandle] loadDevicesFromAPI() 429 fallback cached devices:", this.devices.length);
                return;
            }
        }
        if (deviceResponse.status !== 200)
            throw new Error(`Failed to fetch devices: ${deviceResponse.status}`);
        this.devices = await deviceResponse.json();
        console.log("[DataHandle] loadDevicesFromAPI() devices loaded:", this.devices.length);
        (0, userData_1.write)(FILES.devices, JSON.stringify({
            dataHandleVersion: config_1.default.DataVersion,
            lastRelease: latestRelease,
            devices: this.devices,
        })).catch(err => console.error("[DataHandle] Failed to write devices:", err));
    }
    getDevices(product) {
        return product
            ? this.devices.filter(device => device.identifier.toLocaleLowerCase().startsWith(product))
            : this.devices;
    }
    // ── New public API: get() returns data or "wait" ──────────────────────────
    async get(identifier) {
        const product = this.getProductType(identifier);
        if (!product)
            return { status: "wait" };
        // 1. Check in-memory cache with TTL
        const memEntry = this.modelMap.get(identifier);
        if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
            return { status: "ready", data: memEntry.device };
        }
        // 2. Check file cache
        const file = `products/${product}/${identifier}.json`;
        try {
            const stored = await (0, userData_1.read)(file);
            if (stored) {
                const data = JSON.parse(stored);
                if (data.cachedAt == null)
                    data.cachedAt = 0;
                const isValid = await this.validateOrDeleteFile(file, data);
                if (isValid) {
                    let latestRelease = "";
                    try {
                        latestRelease = await this.getLatestRelease();
                    }
                    catch {
                        latestRelease = (await this.readStoredRelease()) ?? "";
                    }
                    if (!latestRelease || !this.shouldUpdate(data.lastRelease, latestRelease)) {
                        this.modelMap.set(identifier, data);
                        return { status: "ready", data: data.device };
                    }
                }
            }
        }
        catch { /* fall through to queue */ }
        // 3. Cache miss — queue and return "wait"
        this.scheduleFetch(identifier, product, file);
        return { status: "wait" };
    }
    // ── Model data (main process, returns promise) ─────────────────────────────
    async getModelData(identifier) {
        console.log("[DataHandle] getModelData() start:", identifier);
        const product = this.getProductType(identifier);
        console.log("[DataHandle] getModelData() product:", product);
        if (!product)
            return;
        let latestRelease = "";
        try {
            latestRelease = await this.getLatestRelease();
        }
        catch (error) {
            console.error("[DataHandle] getModelData() latestRelease fetch failed:", error);
            latestRelease = (await this.readStoredRelease()) ?? "";
        }
        console.log("[DataHandle] getModelData() latestRelease:", latestRelease);
        // TTL check on memory cache
        const memEntry = this.modelMap.get(identifier);
        if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
            console.log("[DataHandle] getModelData() TTL cache hit:", identifier);
            return memEntry.device;
        }
        const file = `products/${product}/${identifier}.json`;
        try {
            const stored = await (0, userData_1.read)(file);
            console.log("[DataHandle] getModelData() file cache:", stored ? "hit" : "miss", file);
            if (stored) {
                const data = JSON.parse(stored);
                if (data.cachedAt == null)
                    data.cachedAt = 0;
                const isValid = await this.validateOrDeleteFile(file, data);
                console.log("[DataHandle] getModelData() cache version valid:", isValid, "storedRelease:", data.lastRelease);
                if (isValid && !this.shouldUpdate(data.lastRelease, latestRelease)) {
                    this.modelMap.set(identifier, data);
                    console.log("[DataHandle] getModelData() using cached model data:", identifier);
                    return data.device;
                }
            }
        }
        catch (error) {
            console.error("[DataHandle] getModelData() cache read failed:", error);
            await (0, userData_1.deleteFile)(file);
        }
        return this.getModelDataFromAPI(identifier, product, latestRelease, file);
    }
    async getModelDataFromAPI(identifier, product, latestRelease, file) {
        const url = API.getFirmware.replace("{{id}}", identifier);
        console.log("[DataHandle] getModelDataFromAPI() request:", { identifier, product, url, latestRelease });
        const response = await fetch(url);
        console.log("[DataHandle] getModelDataFromAPI() response status:", response.status, identifier);
        if (response.status === 429) {
            const stored = await this.readStoredModelData(file);
            if (stored) {
                this.modelMap.set(identifier, stored);
                console.log("[DataHandle] getModelDataFromAPI() 429 fallback cached model data:", identifier);
                return stored.device;
            }
            return;
        }
        if (response.status !== 200)
            return;
        const deviceData = await response.json();
        console.log("[DataHandle] getModelDataFromAPI() device data received:", identifier);
        const modelData = {
            dataHandleVersion: config_1.default.DataVersion,
            lastRelease: latestRelease,
            device: deviceData,
            cachedAt: Date.now(),
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
    //   2. Queues the real fetch via the concurrent queue.
    //   3. Once resolved, sends { id, device } back via "dh:modelData" IPC event.
    getModelDataForReact(identifier) {
        console.log("[DataHandle] getModelDataForReact() queued:", identifier);
        this.sendEvent("modelData", identifier, null);
        const product = this.getProductType(identifier);
        if (!product) {
            this.sendEvent("modelData", identifier, null);
            return;
        }
        // Cache hit — send right away without hitting the network
        const memEntry = this.modelMap.get(identifier);
        if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
            console.log("[DataHandle] getModelDataForReact() memory cache hit:", identifier);
            this.sendEvent("modelData", identifier, memEntry.device);
            return;
        }
        // Use the new queue; drainQueue emits both deviceDataUpdated and modelData
        const file = `products/${product}/${identifier}.json`;
        this.scheduleFetch(identifier, product, file);
    }
    async getLocalData(identifier) {
        const product = this.getProductType(identifier);
        if (!product)
            return;
        const file = path_1.default.join("products", product, identifier + ".json");
        const stored = await (0, userData_1.read)(file);
        if (stored) {
            return JSON.parse(stored);
        }
        return;
    }
    // Check data in local or remote
    async hasLocalData({ type, identifier }) {
        const userDataPath = electron_1.app.getPath("userData");
        const filePath = type === "devices"
            ? path_1.default.join(userDataPath, FILES.devices)
            : identifier
                ? path_1.default.join(userDataPath, "products", this.getProductType(identifier) ?? "", identifier + ".json")
                : null;
        // console.log(filePath, fe.pathExistsSync(filePath ?? ""));
        if (!filePath)
            return false;
        return await fs_extra_1.default.pathExists(filePath);
    }
}
exports.DataHandle = DataHandle;
