import { BrowserWindow } from "electron";
import config from "../config";
import { ipswAPI } from "./api";
import metadata from "./metadata";
import userData from "./userData";

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

// ─── Constants ────────────────────────────────────────────────────────────────

const FILES = {
  devices: "devices.json",
} as const;

const {
  cacheTtlMs: TTL_MS,
  maxConcurrentFetches: MAX_CONCURRENT,
  requestDelayMs: REQUEST_DELAY_MS,
  maxRetries: MAX_RETRIES,
  retryBaseDelayMs: RETRY_BASE_DELAY_MS,
} = config;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── IpswDataService ──────────────────────────────────────────────────────────

export class DataHandle {
  private win: BrowserWindow | undefined;
  private devices: Device[] = [];
  private modelMap = new Map<string, ModelData>();

  // Selective update
  private updateSet: Set<string> | null = null;
  private latestRelease = "";

  // Concurrent queue
  private pendingIds = new Set<string>();
  private activeFetchCount = 0;

  constructor(window?: BrowserWindow) {
    this.win = window;
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  private sendEvent(channel: EventChannel, ...args: unknown[]): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(`dh:${channel}`, ...args);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private needsUpdate(identifier: string, storedRelease: string): boolean {
    if (this.updateSet === null) {
      return storedRelease !== this.latestRelease;
    }
    return this.updateSet.has(identifier);
  }

  private getProductType(identifier: string): Product | undefined {
    const lower = identifier.toLowerCase();
    if (lower.startsWith("iphone")) return "iphone";
    if (lower.startsWith("ipad")) return "ipad";
    if (lower.startsWith("watch")) return "watch";
    if (lower.startsWith("mac")) return "mac";
    if (lower.startsWith("realitydevice")) return "realitydevice";
    if (lower.startsWith("appletv")) return "tv";
    if (lower.startsWith("homepod") || lower.startsWith("audioaccessory")) return "homepod";
    if (lower.startsWith("ipod")) return "ipod";
    return undefined;
  }

  private async validateOrDeleteFile(filePath: string, stored: StoredData | ModelData): Promise<boolean> {
    if (!stored.dataHandleVersion || stored.dataHandleVersion !== config.DataVersion) {
      await userData.delete(filePath);
      return false;
    }
    return true;
  }

  // ── Fetch with retry (wraps ipswAPI calls) ────────────────────────────────

  private async fetchWithRetry<T>(fn: () => Promise<{ success: boolean; data: T | null; status: number; error?: string }>): Promise<T | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        if (result.success && result.data) return result.data;
        if (result.status === 429 && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
      }
    }
    return null;
  }

  // ── Selective update set ───────────────────────────────────────────────────

  private async buildUpdateSet(): Promise<Set<string> | null> {
    console.log("[DataHandle] buildUpdateSet() start");
    const releasesResult = await ipswAPI.getReleases();
    if (!releasesResult.success || !releasesResult.data) {
      if (releasesResult.status === 429) {
        const storedRelease = await metadata.read<string>("lastRelease");
        if (storedRelease) {
          this.latestRelease = storedRelease;
          return null;
        }
      }
      throw new Error(`Failed to fetch releases: ${releasesResult.status}`);
    }

    const releasesData = releasesResult.data[0];
    const latestDate = releasesData.date;

    // Check if unchanged
    const storedRelease = await metadata.read<string>("lastRelease");
    if (storedRelease === latestDate) {
      console.log("[DataHandle] buildUpdateSet() release unchanged:", latestDate);
      this.latestRelease = latestDate;
      return new Set();
    }

    // Filter out OTA types, parse versions
    const versionSet = new Set<string>();
    for (const release of releasesData.releases) {
      if (release.type.includes("OTA")) continue;
      const parts = release.name.split(" ");
      if (parts.length >= 2) {
        versionSet.add(parts[1]);
      }
    }

    console.log("[DataHandle] buildUpdateSet() unique versions:", versionSet.size);

    // Fetch firmwares for each version
    const updateSet = new Set<string>();
    const versions = [...versionSet];

    for (let i = 0; i < versions.length; i++) {
      try {
        if (i > 0) await sleep(REQUEST_DELAY_MS);

        const result = await ipswAPI.ipsw.getFirmwares(versions[i]);
        if (result.success && result.data) {
          for (const fw of result.data) {
            updateSet.add(fw.identifier);
          }
        } else {
          console.warn("[DataHandle] buildUpdateSet() getFirmwares failed for", versions[i], result.status);
          throw new Error(`getFirmwares failed: ${result.status}`);
        }
      } catch (err) {
        console.error("[DataHandle] buildUpdateSet() version fetch failed:", versions[i], err);
        return null; // fallback
      }
    }

    await metadata.update({ lastRelease: latestDate });
    this.latestRelease = latestDate;
    console.log("[DataHandle] buildUpdateSet() identifiers to update:", updateSet.size);
    return updateSet;
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  async loadDevices(): Promise<void> {
    console.log("[DataHandle] loadDevices() start");

    // Build selective update set
    try {
      this.updateSet = await this.buildUpdateSet();
    } catch (err) {
      console.error("[DataHandle] loadDevices() buildUpdateSet failed:", err);
      this.updateSet = null;
      this.latestRelease = (await metadata.read<string>("lastRelease")) ?? "";
    }

    // Try cached devices
    try {
      const stored = await userData.read<StoredData>(FILES.devices);
      console.log("[DataHandle] loadDevices() stored file:", stored ? "hit" : "miss");
      if (stored) {
        const isValid = await this.validateOrDeleteFile(FILES.devices, stored);
        console.log("[DataHandle] loadDevices() cache version valid:", isValid, "storedRelease:", stored.lastRelease, "latestRelease:", this.latestRelease);
        if (isValid) {
          if (stored.lastRelease === this.latestRelease) {
            this.devices = stored.devices;
            console.log("[DataHandle] loadDevices() using cached devices:", this.devices.length);
            return;
          }
          console.log("[DataHandle] loadDevices() cache stale, refreshing from API");
        }
      }
    } catch (error) {
      console.error("[DataHandle] loadDevices() cache read failed:", error);
      await userData.delete(FILES.devices);
    }

    await this.loadDevicesFromAPI();
  }

  private async loadDevicesFromAPI(): Promise<void> {
    console.log("[DataHandle] loadDevicesFromAPI() start");
    const result = await ipswAPI.getDevices();
    console.log("[DataHandle] loadDevicesFromAPI() response:", result.status, "success:", result.success);

    if (!result.success || !result.data) {
      if (result.status === 429) {
        const stored = await userData.read<StoredData>(FILES.devices);
        if (stored) {
          this.devices = stored.devices;
          console.log("[DataHandle] loadDevicesFromAPI() 429 fallback cached devices:", this.devices.length);
          return;
        }
      }
      throw new Error(`Failed to fetch devices: ${result.status}`);
    }

    this.devices = result.data;
    console.log("[DataHandle] loadDevicesFromAPI() devices loaded:", this.devices.length);

    await userData.write(FILES.devices, {
      dataHandleVersion: config.DataVersion,
      lastRelease: this.latestRelease,
      devices: this.devices,
    } satisfies StoredData);
    console.log("[DataHandle] loadDevicesFromAPI() devices saved with release:", this.latestRelease);
  }

  getDevices(product?: Product): Device[] {
    return product
      ? this.devices.filter(device => device.identifier.toLocaleLowerCase().startsWith(product))
      : this.devices;
  }

  // ── Model data: get() returns data or "wait" ──────────────────────────────

  async get(identifier: string): Promise<{ status: "ready"; data: DeviceResponse } | { status: "wait" }> {
    const product = this.getProductType(identifier);
    if (!product) return { status: "wait" };

    // Memory cache
    const memEntry = this.modelMap.get(identifier);
    if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
      return { status: "ready", data: memEntry.device };
    }

    // File cache
    const file = `products/${product}/${identifier}.json`;
    try {
      const stored = await userData.read<ModelData>(file);
      if (stored) {
        if (stored.cachedAt == null) stored.cachedAt = 0;
        const isValid = await this.validateOrDeleteFile(file, stored);
        if (isValid && !this.needsUpdate(identifier, stored.lastRelease)) {
          this.modelMap.set(identifier, stored);
          return { status: "ready", data: stored.device };
        }
      }
    } catch { /* fall through to queue */ }

    this.scheduleFetch(identifier, file);
    return { status: "wait" };
  }

  // ── Model data (main process, returns promise) ─────────────────────────────

  async getModelData(identifier: string, skipCheck = false): Promise<DeviceResponse | void> {
    const product = this.getProductType(identifier);
    if (!product) return;

    // Memory cache
    const memEntry = this.modelMap.get(identifier);
    if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
      return memEntry.device;
    }

    const file = `products/${product}/${identifier}.json`;

    if (skipCheck) {
      try {
        const stored = await userData.read<ModelData>(file);
        if (stored) {
          if (stored.cachedAt == null) stored.cachedAt = 0;
          this.modelMap.set(identifier, stored);
          return stored.device;
        }
      } catch { /* fall through */ }
      return;
    }

    try {
      const stored = await userData.read<ModelData>(file);
      if (stored) {
        if (stored.cachedAt == null) stored.cachedAt = 0;
        const isValid = await this.validateOrDeleteFile(file, stored);
        if (isValid && !this.needsUpdate(identifier, stored.lastRelease)) {
          this.modelMap.set(identifier, stored);
          return stored.device;
        }
      }
    } catch (error) {
      console.error("[DataHandle] getModelData() cache read failed:", error);
      await userData.delete(file);
    }

    return this.getModelDataFromAPI(identifier, product, file);
  }

  private async getModelDataFromAPI(identifier: string, product: Product, file: string): Promise<DeviceResponse | void> {
    const deviceData = await this.fetchWithRetry(() => ipswAPI.ipsw.getDevice(identifier));
    if (!deviceData) return;

    const modelData: ModelData = {
      dataHandleVersion: config.DataVersion,
      lastRelease: this.latestRelease,
      device: deviceData,
      cachedAt: Date.now(),
    };

    this.modelMap.set(identifier, modelData);
    userData.write(file, modelData).catch(err => console.error("[DataHandle] Failed to write model data:", err));

    return deviceData;
  }

  // ── Model data for React renderer (fire-and-forget) ────────────────────────

  getModelDataForReact(identifier: string): void {
    console.log("[DataHandle] getModelDataForReact() queued:", identifier);
    this.sendEvent("modelData", identifier, null);

    const product = this.getProductType(identifier);
    if (!product) return;

    const memEntry = this.modelMap.get(identifier);
    if (memEntry && (Date.now() - memEntry.cachedAt) < TTL_MS) {
      console.log("[DataHandle] getModelDataForReact() memory cache hit:", identifier);
      this.sendEvent("modelData", identifier, memEntry.device);
      return;
    }

    const file = `products/${product}/${identifier}.json`;
    this.scheduleFetch(identifier, file);
  }

  // ── Cache invalidation ─────────────────────────────────────────────────────

  async invalidateReleaseCache(): Promise<void> {
    this.updateSet = null;
    this.latestRelease = "";
    const current = await metadata.read();
    const { lastRelease: _, ...rest } = current;
    await metadata.write(rest);
  }

  // ── Local data check ───────────────────────────────────────────────────────

  async hasLocalData({ type, identifier }: { type: "devices" | "modelData"; identifier?: string }): Promise<boolean> {
    if (type === "devices") return (await userData.read(FILES.devices)) !== null;
    if (!identifier) return false;
    const product = this.getProductType(identifier);
    if (!product) return false;
    return (await userData.read(`products/${product}/${identifier}.json`)) !== null;
  }

  // ── Concurrent queue ───────────────────────────────────────────────────────

  private scheduleFetch(identifier: string, file: string): void {
    if (this.pendingIds.has(identifier)) return;
    this.pendingIds.add(identifier);
    this.drainQueue(identifier, file);
  }

  private async drainQueue(identifier: string, file: string): Promise<void> {
    while (this.activeFetchCount >= MAX_CONCURRENT) {
      await sleep(50);
    }
    this.activeFetchCount++;

    try {
      await sleep(REQUEST_DELAY_MS);

      // Check file cache again
      try {
        const stored = await userData.read<ModelData>(file);
        if (stored) {
          if (stored.cachedAt == null) stored.cachedAt = 0;
          const isValid = await this.validateOrDeleteFile(file, stored);
          if (isValid && !this.needsUpdate(identifier, stored.lastRelease)) {
            this.modelMap.set(identifier, stored);
            this.pendingIds.delete(identifier);
            this.activeFetchCount--;
            this.sendEvent("deviceDataUpdated", { identifier, data: stored.device });
            this.sendEvent("modelData", identifier, stored.device);
            return;
          }
        }
      } catch { /* proceed to API */ }

      // Fetch from API with retry
      const deviceData = await this.fetchWithRetry(() => ipswAPI.ipsw.getDevice(identifier));
      if (!deviceData) {
        this.pendingIds.delete(identifier);
        this.activeFetchCount--;
        console.error("[DataHandle] drainQueue fetch failed:", identifier);
        return;
      }

      const modelData: ModelData = {
        dataHandleVersion: config.DataVersion,
        lastRelease: this.latestRelease,
        device: deviceData,
        cachedAt: Date.now(),
      };

      this.modelMap.set(identifier, modelData);
      userData.write(file, modelData).catch(err => console.error("[DataHandle] Failed to write model data:", err));

      this.sendEvent("deviceDataUpdated", { identifier, data: deviceData });
      this.sendEvent("modelData", identifier, deviceData);
    } catch (err) {
      console.error("[DataHandle] drainQueue failed:", identifier, err);
    } finally {
      this.pendingIds.delete(identifier);
      this.activeFetchCount--;
    }
  }
}
