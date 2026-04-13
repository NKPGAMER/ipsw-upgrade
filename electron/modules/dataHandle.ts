import { BrowserWindow } from "electron";
import config from "../config";
import { deleteFile, read, write } from "./userData";

// ─── Interfaces ──────────────────────────────────────────────────────────────

type EventChannel = "modelData";

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
  devices:  "devices.json",
} as const;

const API = {
  devices:    "https://api.ipsw.me/v4/devices",
  getFirmware:"https://api.ipsw.me/v4/device/{{id}}?type=ipsw",
  releases:   "https://api.ipsw.me/v4/releases",
} as const;

const METADATA_RELEASE_KEY = "lastRelease";

// ─── Metadata helper ──────────────────────────────────────────────────────────

const metadata = new class {
  private parse(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  async read(): Promise<Record<string, unknown>>;
  async read<T = unknown>(key: string): Promise<T | null>;
  async read<T = unknown>(key?: string): Promise<Record<string, unknown> | T | null> {
    const raw  = await read(FILES.metadata);
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
  private latestRelease: string | undefined;
  private devices:       Device[]  = [];
  private modelMap = new Map<Device["identifier"], ModelData>();
  private win: BrowserWindow | undefined;

  // Queue: prevents API spam when multiple identifiers are requested at once
  private fetchQueue:  Array<() => Promise<void>> = [];
  private fetchActive = false;

  constructor(window?: BrowserWindow) {
    this.win = window;
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  private sendEvent(channel: EventChannel, ...args: unknown[]): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(`dh:${channel}`, ...args);
    }
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  private enqueue(task: () => Promise<void>): void {
    this.fetchQueue.push(task);
    this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.fetchActive) return;
    this.fetchActive = true;
    while (this.fetchQueue.length > 0) {
      const task = this.fetchQueue.shift()!;
      try { await task(); } catch (err) { console.error("[DataHandle] Queue task error:", err); }
    }
    this.fetchActive = false;
  }

  // ── Release ────────────────────────────────────────────────────────────────

  private async getLatestRelease(): Promise<string> {
    if (this.latestRelease) return this.latestRelease;

    const response = await fetch(API.releases);
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
    if (lower.startsWith("iphone"))           return "iphone";
    if (lower.startsWith("ipad"))             return "ipad";
    if (lower.startsWith("watch"))            return "watch";
    if (lower.startsWith("mac"))              return "mac";
    if (lower.startsWith("realitydevice"))    return "realitydevice";
    if (lower.startsWith("appletv"))          return "tv";
    if (lower.startsWith("homepod")
      || lower.startsWith("audioaccessory"))  return "homepod";
    if (lower.startsWith("ipod"))             return "ipod";
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
    try {
      const stored = await read(FILES.devices);
      if (stored) {
        const data: StoredData = JSON.parse(stored);
        const isValid = await this.validateOrDeleteFile(FILES.devices, data);
        if (isValid) {
          const latestRelease = await this.getLatestRelease();
          if (!this.shouldUpdate(data.lastRelease, latestRelease)) {
            this.devices = data.devices;
            return;
          }
        }
      }
    } catch {
      await deleteFile(FILES.devices);
    }

    await this.loadDevicesFromAPI();
  }

  private async loadDevicesFromAPI(): Promise<void> {
    try {
      const [deviceResponse, latestRelease] = await Promise.all([
        fetch(API.devices),
        this.getLatestRelease(),
      ]);

      if (deviceResponse.status !== 200) throw new Error(`Failed to fetch devices: ${deviceResponse.status}`);

      this.devices = await deviceResponse.json();

      write(FILES.devices, JSON.stringify({
        dataHandleVersion: config.DataVersion,
        lastRelease: latestRelease,
        devices: this.devices,
      } satisfies StoredData)).catch(err => console.error("[DataHandle] Failed to write devices:", err));
    } catch {
      const stored = await read(FILES.devices);
      if (stored) {
        const data: StoredData = JSON.parse(stored);
        this.devices = data.devices;
      }
    }
  }

  getDevices(product?: Product): Device[] {
    return product
    ? this.devices.filter(device => device.identifier.toLocaleLowerCase().startsWith(product))
    : this.devices;
  }

  // ── Model data (main process, returns promise) ─────────────────────────────

  async getModelData(identifier: Device["identifier"]): Promise<DeviceResponse | void> {
    const product = this.getProductType(identifier);
    if (!product) return;

    const latestRelease = await this.getLatestRelease();

    if (this.modelMap.has(identifier)) return this.modelMap.get(identifier)!.device;

    const file = `products/${product}/${identifier}.json`;
    try {
      const stored = await read(file);
      if (stored) {
        const data: ModelData = JSON.parse(stored);
        const isValid = await this.validateOrDeleteFile(file, data);
        if (isValid && !this.shouldUpdate(data.lastRelease, latestRelease)) {
          this.modelMap.set(identifier, data);
          return data.device;
        }
      }
    } catch {
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
    const response = await fetch(API.getFirmware.replace("{{id}}", identifier));
    if (response.status !== 200) return;

    const deviceData: DeviceResponse = await response.json();
    const modelData: ModelData = {
      dataHandleVersion: config.DataVersion,
      lastRelease: latestRelease,
      device: deviceData,
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
  //   2. Queues the real fetch (serialised – no API spam).
  //   3. Once resolved, sends { id, device } back via "dh:modelData" IPC event.

  getModelDataForReact(identifier: Device["identifier"]): void {
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
        this.sendEvent("modelData", identifier, this.modelMap.get(identifier)!.device);
        return;
      }

      const device = await this.getModelData(identifier);
      this.sendEvent("modelData", identifier, device ?? null);
    });
  }
}