import { app, BrowserWindow } from "electron";
import config from "../config";
import { deleteFile, read, write } from "./userData";
import path from "path";
import fe from "fs-extra";

// ─── Interfaces ──────────────────────────────────────────────────────────────

type EventChannel = "modelData" | "deviceDataUpdated";

interface StoredData {
  dataHandleVersion: string;
  lastRelease: string;
  devices: Device[];
}

interface ModelData {
  dataHandleVersion: string;
  lastRelease: string;
  device: DeviceResponse;
  cachedAt: number;
}

interface ReleaseResponse {
  date: string;
  releases: {
    name: string;
    date: string;
    count: number;
    type: string;
  }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FILES = {
  metadata: "metadata.json",
  devices: "devices.json",
} as const;

const API = {
  devices: "https://api.ipsw.me/v4/devices",
  getFirmware: "https://api.ipsw.me/v4/device/{{id}}?type=ipsw",
  releases: "https://api.ipsw.me/v4/releases",
} as const;

const METADATA_RELEASE_KEY = "lastRelease";

// Queue & cache tuning
const {
  cacheTtlMs: TTL_MS,
  maxConcurrentFetches: MAX_CONCURRENT,
  requestDelayMs: REQUEST_DELAY_MS,
  maxRetries: MAX_RETRIES,
  retryBaseDelayMs: RETRY_BASE_DELAY_MS,
} = config;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Metadata helper ──────────────────────────────────────────────────────────

const metadata = new class {
  private parse(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  async read(): Promise<Record<string, unknown>>;
  async read<T = unknown>(key: string): Promise<T | null>;
  async read<T = unknown>(key?: string): Promise<Record<string, unknown> | T | null> {
    const raw = await read(FILES.metadata);
    const data = this.parse(raw);
    if (key === undefined) return data;
    return (data[key] as T) ?? null;
  }

  async write(data: Record<string, unknown>): Promise<boolean> {
    try {
      await write(FILES.metadata, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error("[metadata] Failed to write:", error);
      return false;
    }
  }

  async update(patch: Record<string, unknown>): Promise<boolean> {
    const current = await this.read();
    return this.write({ ...current, ...patch });
  }
};

// ─── DataHandle ───────────────────────────────────────────────────────────────

export class DataHandle {
  private readonly DATA_DIR = path.join(app.getPath("userData"), "ipswData");
  private readonly FILES = {
    metadata: path.join(this.DATA_DIR, FILES.metadata),
    devices: path.join(this.DATA_DIR, FILES.devices),
    products: path.join(this.DATA_DIR, "products"),
  } as const;
  private latestRelease: string | undefined;
  private devices: Device[] = [];
  private modelMap = new Map<Device["identifier"], ModelData>();
  private win: BrowserWindow | undefined;

  // Concurrent queue: dedup + rate-limit + retry
  private pendingIds = new Set<string>();
  private activeFetchCount = 0;

  constructor(window?: BrowserWindow) {
    this.win = window;
    fe.ensureDir(this.DATA_DIR);
    fe.ensureDir(this.FILES.products);
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  private sendEvent(channel: EventChannel, ...args: unknown[]): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(`dh:${channel}`, ...args);
    }
  }

  // ── Queue (concurrent + dedup + retry) ────────────────────────────────────

  private async fetchWithRetry(url: string): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0");
          const delay = Math.max(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), retryAfter * 1000);
          if (attempt < MAX_RETRIES) { await sleep(delay); continue; }
        }
        return res;
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${url}`);
      }
    }
    throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${url}`);
  }

  private async readStoredModelData(file: string): Promise<ModelData | null> {
    try {
      const stored = await read(file);
      if (!stored) return null;
      const data: ModelData = JSON.parse(stored);
      if (data.cachedAt == null) data.cachedAt = 0;
      return data;
    } catch {
      return null;
    }
  }

  private async readStoredDevices(): Promise<StoredData | null> {
    try {
      const stored = await read(FILES.devices);
      if (!stored) return null;
      return JSON.parse(stored) as StoredData;
    } catch {
      return null;
    }
  }

  private async readStoredRelease(): Promise<string | null> {
    try {
      const stored = await metadata.read<string>(METADATA_RELEASE_KEY);
      return stored ?? null;
    } catch {
      return null;
    }
  }

  private scheduleFetch(identifier: string, _product: Product, file: string): void {
    if (this.pendingIds.has(identifier)) return;
    this.pendingIds.add(identifier);
    this.drainQueue(identifier, file);
  }

  private async drainQueue(identifier: string, file: string): Promise<void> {
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
      } catch (error) {
        console.error("[DataHandle] latestRelease fetch failed in queue:", error);
        latestRelease = (await this.readStoredRelease()) ?? "";
      }

      // Check file cache again (might have been populated while waiting)
      try {
        const stored = await read(file);
        if (stored) {
          const data: ModelData = JSON.parse(stored);
          if (data.cachedAt == null) data.cachedAt = 0;
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
      } catch { /* proceed to API */ }

      const url = API.getFirmware.replace("{{id}}", identifier);
      const response = await this.fetchWithRetry(url);
      if (response.status !== 200) {
        this.pendingIds.delete(identifier);
        this.activeFetchCount--;
        console.error("[DataHandle] fetch failed status:", response.status, identifier);
        return;
      }

      const deviceData: DeviceResponse = await response.json();
      const modelData: ModelData = {
        dataHandleVersion: config.DataVersion,
        lastRelease: latestRelease,
        device: deviceData,
        cachedAt: Date.now(),
      };

      this.modelMap.set(identifier, modelData);
      write(file, JSON.stringify(modelData)).catch(err =>
        console.error("[DataHandle] Failed to write model data:", err));

      this.sendEvent("deviceDataUpdated", { identifier, data: deviceData });
      this.sendEvent("modelData", identifier, deviceData);
    } catch (err) {
      console.error("[DataHandle] drainQueue failed:", identifier, err);
    } finally {
      this.pendingIds.delete(identifier);
      this.activeFetchCount--;
    }
  }

  // ── Release ────────────────────────────────────────────────────────────────

  private async getLatestRelease(): Promise<string> {
    if (this.latestRelease) return this.latestRelease;

    const response = await fetch(API.releases);
    if (response.status === 429) {
      const localRelease = await this.readStoredRelease();
      if (localRelease) {
        this.latestRelease = localRelease;
        return localRelease;
      }
      throw new Error(`Failed to fetch releases: ${response.status}`);
    }
    if (response.status !== 200) throw new Error(`Failed to fetch releases: ${response.status}`);

    const data: ReleaseResponse[] = await response.json();
    const latestDate = data[0].date;

    this.latestRelease = latestDate;
    await metadata.update({ [METADATA_RELEASE_KEY]: latestDate });
    return latestDate;
  }

  async invalidateReleaseCache(): Promise<void> {
    this.latestRelease = undefined;
    const current = await metadata.read();
    const { [METADATA_RELEASE_KEY]: _, ...rest } = current;
    await metadata.write(rest);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private shouldUpdate(storedRelease: string, latestRelease: string): boolean {
    return storedRelease !== latestRelease;
  }

  private getProductType(identifier: string): Product | undefined {
    const lower = identifier.toLowerCase();
    if (lower.startsWith("iphone")) return "iphone";
    if (lower.startsWith("ipad")) return "ipad";
    if (lower.startsWith("watch")) return "watch";
    if (lower.startsWith("mac")) return "mac";
    if (lower.startsWith("realitydevice")) return "realitydevice";
    if (lower.startsWith("appletv")) return "tv";
    if (lower.startsWith("homepod")
      || lower.startsWith("audioaccessory")) return "homepod";
    if (lower.startsWith("ipod")) return "ipod";
    return undefined;
  }

  private async validateOrDeleteFile(filePath: string, stored: StoredData | ModelData): Promise<boolean> {
    if (!stored.dataHandleVersion || stored.dataHandleVersion !== config.DataVersion) {
      await deleteFile(filePath);
      return false;
    }
    return true;
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  async loadDevices(): Promise<void> {
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
          } catch (error) {
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
    } catch (error) {
      console.error("[DataHandle] loadDevices() cache read failed:", error);
      await deleteFile(FILES.devices);
    }

    await this.loadDevicesFromAPI();
  }

  private async loadDevicesFromAPI(): Promise<void> {
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
    if (deviceResponse.status !== 200) throw new Error(`Failed to fetch devices: ${deviceResponse.status}`);

    this.devices = await deviceResponse.json();
    console.log("[DataHandle] loadDevicesFromAPI() devices loaded:", this.devices.length);

    write(FILES.devices, JSON.stringify({
      dataHandleVersion: config.DataVersion,
      lastRelease: latestRelease,
      devices: this.devices,
    } satisfies StoredData)).catch(err => console.error("[DataHandle] Failed to write devices:", err));
  }

  getDevices(product?: Product): Device[] {
    return product
      ? this.devices.filter(device => device.identifier.toLocaleLowerCase().startsWith(product))
      : this.devices;
  }

  // ── New public API: get() returns data or "wait" ──────────────────────────

  async get(identifier: string): Promise<{ status: "ready"; data: DeviceResponse } | { status: "wait" }> {
    const product = this.getProductType(identifier);
    if (!product) return { status: "wait" };

    // 1. Check in-memory cache with TTL
    const memEntry = this.modelMap.get(identifier);
    if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
      return { status: "ready", data: memEntry.device };
    }

    // 2. Check file cache
    const file = `products/${product}/${identifier}.json`;
    try {
      const stored = await read(file);
      if (stored) {
        const data: ModelData = JSON.parse(stored);
        if (data.cachedAt == null) data.cachedAt = 0;
        const isValid = await this.validateOrDeleteFile(file, data);
        if (isValid) {
          let latestRelease = "";
          try {
            latestRelease = await this.getLatestRelease();
          } catch {
            latestRelease = (await this.readStoredRelease()) ?? "";
          }
          if (!latestRelease || !this.shouldUpdate(data.lastRelease, latestRelease)) {
            this.modelMap.set(identifier, data);
            return { status: "ready", data: data.device };
          }
        }
      }
    } catch { /* fall through to queue */ }

    // 3. Cache miss — queue and return "wait"
    this.scheduleFetch(identifier, product, file);
    return { status: "wait" };
  }

  // ── Model data (main process, returns promise) ─────────────────────────────

  async getModelData(identifier: Device["identifier"], skipCheck = false): Promise<DeviceResponse | void> {
    const product = this.getProductType(identifier);
    if (!product) return;

    // TTL check on memory cache — always fast, always allowed
    const memEntry = this.modelMap.get(identifier);
    if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
      return memEntry.device;
    }

    const file = `products/${product}/${identifier}.json`;

    // skipCheck: return local data directly, no API verification
    if (skipCheck) {
      try {
        const stored = await read(file);
        if (stored) {
          const data: ModelData = JSON.parse(stored);
          if (data.cachedAt == null) data.cachedAt = 0;
          this.modelMap.set(identifier, data);
          return data.device;
        }
      } catch { /* fall through to void */ }
      return;
    }

    let latestRelease = "";
    try {
      latestRelease = await this.getLatestRelease();
    } catch (error) {
      console.error("[DataHandle] getModelData() latestRelease fetch failed:", error);
      latestRelease = (await this.readStoredRelease()) ?? "";
    }

    try {
      const stored = await read(file);
      console.log("[DataHandle] getModelData() file cache:", stored ? "hit" : "miss", file);
      if (stored) {
        const data: ModelData = JSON.parse(stored);
        if (data.cachedAt == null) data.cachedAt = 0;
        const isValid = await this.validateOrDeleteFile(file, data);
        console.log("[DataHandle] getModelData() cache version valid:", isValid, "storedRelease:", data.lastRelease);
        if (isValid && !this.shouldUpdate(data.lastRelease, latestRelease)) {
          this.modelMap.set(identifier, data);
          console.log("[DataHandle] getModelData() using cached model data:", identifier);
          return data.device;
        }
      }
    } catch (error) {
      console.error("[DataHandle] getModelData() cache read failed:", error);
      await deleteFile(file);
    }

    return this.getModelDataFromAPI(identifier, product, latestRelease, file);
  }

  private async getModelDataFromAPI(
    identifier: Device["identifier"],
    product: Product,
    latestRelease: string,
    file: string,
  ): Promise<DeviceResponse | void> {
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
    if (response.status !== 200) return;

    const deviceData: DeviceResponse = await response.json();
    console.log("[DataHandle] getModelDataFromAPI() device data received:", identifier);
    const modelData: ModelData = {
      dataHandleVersion: config.DataVersion,
      lastRelease: latestRelease,
      device: deviceData,
      cachedAt: Date.now(),
    };

    this.modelMap.set(identifier, modelData);
    write(file, JSON.stringify(modelData)).catch(err => console.error("[DataHandle] Failed to write model data:", err));

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

  getModelDataForReact(identifier: Device["identifier"]): void {
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

  // Check data in local or remote
  public async hasLocalData({ type, identifier }: { type: "devices" | "modelData"; identifier?: Device["identifier"] }): Promise<boolean> {
    const userDataPath = app.getPath("userData");
    const filePath = type === "devices"
      ? path.join(userDataPath, FILES.devices)
      : identifier
        ? path.join(userDataPath, "products", this.getProductType(identifier) ?? "", identifier + ".json")
        : null;

    if (!filePath) return false;
    return fe.pathExistsSync(filePath);
  }
}