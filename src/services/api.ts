import type { DiskInfo } from "../../electron/i10r-addon/index";
import type { UpdateStatus, UpdateAvailableData, UpdateProgressData } from "../../@types/preload";

const sendError = (method: string, error: unknown) =>
  console.error(`[Services::${method}] - ${error}`);

// ── Application ──────────────────────────────────────────────────────────────────

export const app = {
  relaunch() {
    try { window.api?.relaunch(); }
    catch (error) { sendError("app::relaunch", error); }
  },
  ready() {
    try { window.api?.ready(); }
    catch (error) { sendError("app::ready", error); }
  },
  get version(): string {
    try { return window.api?.getVersion ?? "0.0.0"; }
    catch { return "0.0.0"; }
  },
};

// ── Disk ─────────────────────────────────────────────────────────────────────────

export const disk = {
  async getDiskInfo(path?: string): Promise<DiskInfo | null> {
    try { return await window.api?.getDiskInfo(path) ?? null; }
    catch (error) { sendError("disk::getDiskInfo", error); return null; }
  },

  async getAllDisk(): Promise<DiskInfo[] | void> {
    try { return await window.api?.getAllDisk(); }
    catch (error) { sendError("disk::getAllDisk", error); }
  },

  async formatBytes(bytes: number, decimals?: number): Promise<string | void> {
    try { return await window.api?.formatBytes(bytes, decimals); }
    catch (error) { sendError("disk::formatBytes", error); }
  },
};

// ── Data (device / firmware / model) ─────────────────────────────────────────────

export const data = {
  async getDevices(product?: Product): Promise<Device[] | void> {
    try { return await window.api?.getDevices(product); }
    catch (error) { sendError("data::getDevices", error); }
  },

  async getModelData(identifier: Device["identifier"]): Promise<DeviceResponse | void> {
    try { return await window.api?.getModelData(identifier); }
    catch (error) { sendError("data::getModelData", error); }
  },

  async getDeviceModelData(identifier: string): Promise<ModelDataResult | void> {
    try { return await window.api?.getDeviceModelData(identifier); }
    catch (error) { sendError("data::getDeviceModelData", error); }
  },

  requestModelData(identifier: Device["identifier"]) {
    try { window.api?.requestModelData(identifier); }
    catch (error) { sendError("data::requestModelData", error); }
  },

  onDeviceDataUpdated(cb: (payload: DeviceDataUpdatedPayload) => void): (() => void) | void {
    try { return window.api?.onDeviceDataUpdated(cb); }
    catch (error) { sendError("data::onDeviceDataUpdated", error); }
  },

  onModelData(cb: (identifier: string, device: DeviceResponse | null) => void): (() => void) | void {
    try { return window.api?.onModelData(cb); }
    catch (error) { sendError("data::onModelData", error); }
  },
};

// ── Store (electron-store wrapper) ────────────────────────────────────────────────

export const store = {
  async get(key: string): Promise<any> {
    try { return await window.store?.get(key); }
    catch (error) { sendError("store::get", error); }
  },

  async set(key: string, value?: any): Promise<void> {
    try { await window.store?.set(key, value); }
    catch (error) { sendError("store::set", error); }
  },

  async has(key: string): Promise<boolean | void> {
    try { return await window.store?.has(key); }
    catch (error) { sendError("store::has", error); }
  },

  async delete(key: string): Promise<void> {
    try { await window.store?.delete(key); }
    catch (error) { sendError("store::delete", error); }
  },
};

// ── Updater ───────────────────────────────────────────────────────────────────────

export const updater = {
  async getStatus(): Promise<UpdateStatus | void> {
    try { return await window.updater?.getStatus(); }
    catch (error) { sendError("updater::getStatus", error); }
  },

  onUpdateAvailable(cb: (data: UpdateAvailableData) => void): EventResponse | void {
    try { return window.updater?.onUpdateAvailable(cb); }
    catch (error) { sendError("updater::onUpdateAvailable", error); }
  },

  onUpdateReady(cb: () => void): EventResponse | void {
    try { return window.updater?.onUpdateReady(cb); }
    catch (error) { sendError("updater::onUpdateReady", error); }
  },

  onUpdateProgress(cb: (data: UpdateProgressData) => void): EventResponse | void {
    try { return window.updater?.onUpdateProgress(cb); }
    catch (error) { sendError("updater::onUpdateProgress", error); }
  },

  onUpdateNotAvailable(cb: () => void): EventResponse | void {
    try { return window.updater?.onUpdateNotAvailable(cb); }
    catch (error) { sendError("updater::onUpdateNotAvailable", error); }
  },
};

// ── File ──────────────────────────────────────────────────────────────────────────

export const file = {
  async getFiles(): Promise<IPSWFile[] | void> {
    try { return await window.api?.file?.getFiles(); }
    catch (error) { sendError("file::getFiles", error); }
  },

  async delete(target: string | string[] | IPSWFile | IPSWFile[]): Promise<void> {
    try { await window.api?.file?.delete(target); }
    catch (error) { sendError("file::delete", error); }
  },

  async changeDir(newDir: string): Promise<void> {
    try { await window.api?.file?.changeDir(newDir); }
    catch (error) { sendError("file::changeDir", error); }
  },

  onReload(cb: (files: IPSWFile[]) => void): EventResponse | void {
    try { return window.api?.file?.onReload(cb); }
    catch (error) { sendError("file::onReload", error); }
  },
};

// ── Dialog ────────────────────────────────────────────────────────────────────────

export const dialog = {
  async selectFolder(): Promise<string | void> {
    try { return await window.api?.selectFolder?.() ?? undefined; }
    catch (error) { sendError("dialog::selectFolder", error); }
  },

  async selectFile(options?: Electron.FileFilter[]): Promise<string | void> {
    try { return await window.api?.selectFile?.(options) ?? undefined; }
    catch (error) { sendError("dialog::selectFile", error); }
  },
};

// ── Messages ──────────────────────────────────────────────────────────────────────

export const messages = {
  onMessage(cb: (message: string, options?: { type: "success" | "error" | "warning" | "info" }) => void): EventResponse | void {
    try { return window.api?.onMessage(cb); }
    catch (error) { sendError("messages::onMessage", error); }
  },
};
