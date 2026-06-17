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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FILES = {
  devices: "devices.json",
} as const;

const {
  maxConcurrentFetches: MAX_CONCURRENT,
  requestDelayMs: REQUEST_DELAY_MS,
  maxRetries: MAX_RETRIES,
  retryBaseDelayMs: RETRY_BASE_DELAY_MS,
} = config;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Semaphore ────────────────────────────────────────────────────────────────

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.count = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

// ─── Product type map ─────────────────────────────────────────────────────────

const PRODUCT_PREFIX_MAP: Array<[string, Product]> = [
  ["iphone", "iphone"],
  ["ipad", "ipad"],
  ["watch", "watch"],
  ["mac", "mac"],
  ["realitydevice", "realitydevice"],
  ["appletv", "tv"],
  ["homepod", "homepod"],
  ["audioaccessory", "homepod"],
  ["ipod", "ipod"],
];

// ─── DataHandle ───────────────────────────────────────────────────────────────

export class DataHandle {
  private win: BrowserWindow | undefined;
  private devices: Device[] = [];
  private modelMap = new Map<string, ModelData>();

  private updateSet: Set<string> | null = null;
  private latestRelease = "";

  private inflightRequests = new Map<string, Promise<DeviceResponse | null>>();
  private semaphore = new Semaphore(MAX_CONCURRENT);
  private activeIds = new Set<string>();

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

  /**
   * Kiểm tra xem một entry (memory hoặc disk) có cần fetch lại không.
   *
   * Trả về `true` (cần update) khi:
   *   1. dataHandleVersion không khớp config.DataVersion — schema thay đổi
   *   2. lastRelease không khớp latestRelease VÀ identifier nằm trong updateSet
   */
  private needsUpdate(
    identifier: string,
    storedRelease: string,
    storedVersion: string,
  ): boolean {
    if (storedVersion !== config.DataVersion) return true;

    if (storedRelease === this.latestRelease) return false;

    if (this.updateSet === null) return true;

    return this.updateSet.has(identifier);
  }

  private getProductType(identifier: string): Product | undefined {
    const lower = identifier.toLowerCase();
    for (const [prefix, product] of PRODUCT_PREFIX_MAP) {
      if (lower.startsWith(prefix)) return product;
    }
    return undefined;
  }

  private async validateOrDeleteFile(
    filePath: string,
    stored: StoredData | ModelData
  ): Promise<boolean> {
    if (!stored.dataHandleVersion || stored.dataHandleVersion !== config.DataVersion) {
      await userData.delete(filePath);
      return false;
    }

    if ("devices" in stored) {
      const s = stored as StoredData;
      if (!s.lastRelease || !Array.isArray(s.devices)) {
        console.warn(`[DataHandle] validateOrDeleteFile: StoredData failed schema check for "${filePath}"`);
        await userData.delete(filePath);
        return false;
      }
    } else {
      const m = stored as ModelData;
      if (!m.lastRelease || !m.device) {
        console.warn(`[DataHandle] validateOrDeleteFile: ModelData failed schema check for "${filePath}"`);
        await userData.delete(filePath);
        return false;
      }
    }

    return true;
  }

  // ── Fetch with retry ───────────────────────────────────────────────────────

  private async fetchWithRetry<T>(
    fn: () => Promise<{ success: boolean; data: T | null; status: number; error?: string }>
  ): Promise<T | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        if (result.success && result.data) return result.data;
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

    const storedRelease = await metadata.read<string>("lastRelease");
    if (storedRelease === latestDate) {
      console.log("[DataHandle] buildUpdateSet() release unchanged:", latestDate);
      this.latestRelease = latestDate;
      return new Set();
    }

    const versionSet = new Set<string>();
    for (const release of releasesData.releases) {
      if (release.type.includes("OTA")) continue;
      const parts = release.name.split(" ");
      if (parts.length >= 2) {
        versionSet.add(parts[1]);
      }
    }

    console.log("[DataHandle] buildUpdateSet() unique versions:", versionSet.size);

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
        return null;
      }
    }

    await metadata.update({ lastRelease: latestDate });
    this.latestRelease = latestDate;
    console.log("[DataHandle] buildUpdateSet() identifiers to update:", updateSet.size);
    return updateSet;
  }

  // ── Reconcile update set against local cache ──────────────────────────────

  /**
   * Loại bỏ khỏi updateSet những identifier mà file local đã có lastRelease
   * khớp với this.latestRelease — tránh fetch API không cần thiết.
   */
  private async reconcileUpdateSet(updateSet: Set<string>): Promise<void> {
    if (updateSet.size === 0) return;

    console.log("[DataHandle] reconcileUpdateSet() checking", updateSet.size, "identifiers");

    const identifiers = [...updateSet];

    await Promise.all(
      identifiers.map(async (identifier) => {
        const product = this.getProductType(identifier);
        if (!product) {
          updateSet.delete(identifier);
          return;
        }

        const file = `products/${product}/${identifier}.json`;
        try {
          const stored = await userData.read<ModelData>(file);
          if (!stored) return; // không có file → giữ trong updateSet

          const isValid = await this.validateOrDeleteFile(file, stored);
          if (!isValid) return; // file hỏng / version sai → giữ trong updateSet

          if (stored.lastRelease === this.latestRelease) {
            // Local đã up-to-date → không cần fetch, xoá khỏi danh sách
            updateSet.delete(identifier);

            if (!this.modelMap.has(identifier) && stored.dataHandleVersion === config.DataVersion) {
              this.modelMap.set(identifier, stored);
            }
          }
          // Nếu khác lastRelease → giữ trong updateSet, sẽ fetch sau
        } catch {

        }
      })
    );

    console.log("[DataHandle] reconcileUpdateSet() remaining after reconcile:", updateSet.size);
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  async loadDevices(): Promise<void> {
    console.log("[DataHandle] loadDevices() start");

    try {
      this.updateSet = await this.buildUpdateSet();
      if (this.updateSet && this.updateSet.size > 0) {
        await this.reconcileUpdateSet(this.updateSet);
      }
    } catch (err) {
      console.error("[DataHandle] loadDevices() buildUpdateSet failed:", err);
      this.updateSet = null;
      this.latestRelease = (await metadata.read<string>("lastRelease")) ?? "";
    }

    try {
      const stored = await userData.read<StoredData>(FILES.devices);
      console.log("[DataHandle] loadDevices() stored file:", stored ? "hit" : "miss");
      if (stored) {
        const isValid = await this.validateOrDeleteFile(FILES.devices, stored);
        console.log("[DataHandle] loadDevices() cache version valid:", isValid, "storedRelease:", stored.lastRelease, "latestRelease:", this.latestRelease);
        if (isValid && stored.lastRelease === this.latestRelease) {
          this.devices = stored.devices;
          console.log("[DataHandle] loadDevices() using cached devices:", this.devices.length);
          return;
        }
        console.log("[DataHandle] loadDevices() cache stale, refreshing from API");
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

  // ── Model data: get() ─────────────────────────────────────────────────────

  async get(
    identifier: string
  ): Promise<{ status: "ready"; data: DeviceResponse } | { status: "wait" }> {
    const product = this.getProductType(identifier);
    if (!product) return { status: "wait" };

    const memEntry = this.modelMap.get(identifier);
    if (memEntry && !this.needsUpdate(identifier, memEntry.lastRelease, memEntry.dataHandleVersion)) {
      return { status: "ready", data: memEntry.device };
    }

    const file = `products/${product}/${identifier}.json`;
    try {
      const stored = await userData.read<ModelData>(file);
      if (stored) {
        const isValid = await this.validateOrDeleteFile(file, stored);

        if (isValid && !this.needsUpdate(identifier, stored.lastRelease, stored.dataHandleVersion)) {
          this.modelMap.set(identifier, stored);
          return { status: "ready", data: stored.device };
        }
      }
    } catch { /* fall through to queue */ }

    this.scheduleFetch(identifier, file);
    return { status: "wait" };
  }

  // ── Model data (main process) ─────────────────────────────────────────────

  async getModelData(identifier: string, skipCheck = false): Promise<DeviceResponse | null> {
    const product = this.getProductType(identifier);
    if (!product) return null;

    const memEntry = this.modelMap.get(identifier);
    if (memEntry && !this.needsUpdate(identifier, memEntry.lastRelease, memEntry.dataHandleVersion)) {
      return memEntry.device;
    }

    const file = `products/${product}/${identifier}.json`;

    if (skipCheck) {
      try {
        const stored = await userData.read<ModelData>(file);
        if (stored) {
          this.modelMap.set(identifier, stored);
          return stored.device;
        }
      } catch { /* fall through */ }
      return null;
    }

    try {
      const stored = await userData.read<ModelData>(file);
      if (stored) {
        const isValid = await this.validateOrDeleteFile(file, stored);

        if (isValid && !this.needsUpdate(identifier, stored.lastRelease, stored.dataHandleVersion)) {
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

  private async getModelDataFromAPI(
    identifier: string,
    product: Product,
    file: string
  ): Promise<DeviceResponse | null> {
    const existing = this.inflightRequests.get(identifier);
    if (existing) return existing ?? null;

    console.log(`[ipswData::getModelData] - Load ${identifier}`);
    const promise = this.fetchWithRetry(() => ipswAPI.ipsw.getDevice(identifier))
      .then(async (deviceData) => {
        if (!deviceData) return null;

        const modelData: ModelData = {
          dataHandleVersion: config.DataVersion,
          lastRelease: this.latestRelease,
          device: deviceData,
        };

        this.modelMap.set(identifier, modelData);
        await userData.write(file, modelData).catch(err =>
          console.error("[DataHandle] Failed to write model data:", err)
        );

        return deviceData;
      })
      .finally(() => {
        this.inflightRequests.delete(identifier);
      });

    this.inflightRequests.set(identifier, promise);
    return (await promise) ?? null;
  }

  // ── Model data for React renderer ─────────────────────────────────────────

  getModelDataForReact(identifier: string): void {
    console.log("[DataHandle] getModelDataForReact() queued:", identifier);
    this.sendEvent("modelData", identifier, null);

    const product = this.getProductType(identifier);
    if (!product) return;

    const memEntry = this.modelMap.get(identifier);
    if (memEntry && !this.needsUpdate(identifier, memEntry.lastRelease, memEntry.dataHandleVersion)) {
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

  async hasLocalData({
    type,
    identifier,
  }: {
    type: "devices" | "modelData";
    identifier?: string;
  }): Promise<boolean> {
    if (type === "devices") return (await userData.read(FILES.devices)) !== null;
    if (!identifier) return false;
    const product = this.getProductType(identifier);
    if (!product) return false;
    return (await userData.read(`products/${product}/${identifier}.json`)) !== null;
  }

  // ── Concurrent queue ───────────────────────────────────────────────────────

  private scheduleFetch(identifier: string, file: string): void {
    if (this.activeIds.has(identifier)) return;
    if (this.inflightRequests.has(identifier)) return;
    this.activeIds.add(identifier);
    this.drainQueue(identifier, file);
  }

  private async drainQueue(identifier: string, file: string): Promise<void> {
    await this.semaphore.acquire();

    try {
      await sleep(REQUEST_DELAY_MS);

      try {
        const stored = await userData.read<ModelData>(file);
        if (stored) {
          const isValid = await this.validateOrDeleteFile(file, stored);

          if (isValid && !this.needsUpdate(identifier, stored.lastRelease, stored.dataHandleVersion)) {
            this.modelMap.set(identifier, stored);
            this.activeIds.delete(identifier);
            this.semaphore.release();
            this.sendEvent("deviceDataUpdated", { identifier, data: stored.device });
            this.sendEvent("modelData", identifier, stored.device);
            return;
          }
        }
      } catch { /* proceed to API */ }

      let deviceData: DeviceResponse | null = null;
      const existing = this.inflightRequests.get(identifier);
      if (existing) {
        deviceData = await existing;
      } else {
        console.log(`[ipswData::drainQueue] - Load ${identifier}`);
        const promise = this.fetchWithRetry(() => ipswAPI.ipsw.getDevice(identifier)).finally(
          () => { this.inflightRequests.delete(identifier); }
        );
        this.inflightRequests.set(identifier, promise);
        deviceData = await promise;
      }

      if (!deviceData) {
        console.error("[DataHandle] drainQueue fetch failed:", identifier);
        return;
      }

      const modelData: ModelData = {
        dataHandleVersion: config.DataVersion,
        lastRelease: this.latestRelease,
        device: deviceData,
      };

      this.modelMap.set(identifier, modelData);
      await userData.write(file, modelData).catch(err =>
        console.error("[DataHandle] Failed to write model data:", err)
      );

      this.sendEvent("deviceDataUpdated", { identifier, data: deviceData });
      this.sendEvent("modelData", identifier, deviceData);
    } catch (err) {
      console.error("[DataHandle] drainQueue failed:", identifier, err);
    } finally {
      this.activeIds.delete(identifier);
      this.semaphore.release();
    }
  }
}