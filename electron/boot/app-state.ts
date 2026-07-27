import { app, BrowserWindow } from "electron";
import Store from "electron-store";
import config from "../config";
import type { DownloaderMain } from "../modules/downloader";
import type { DataHandle } from "../services/ipswData";
import type { IPSWWatcher } from "../modules/ipswWatcher";
import type { IPSWHardLinkManager } from "../modules/ipswHardLinkManager";
import type { IPSWCleanupManager } from "../modules/ipsw-cleanup";

export const store = new Store({ defaults: config.defaultAppSettings });

export const s = store as unknown as Record<string, any> & {
  get: (k: string) => any;
  set: (k: string, v: any) => void;
  has: (k: string) => boolean;
  delete: (k: string) => void;
};

export const storeGet = (key: string, fallback?: any) => s.get(key) ?? fallback;

export const state = {
  dl: undefined as DownloaderMain | undefined,
  dh: undefined as DataHandle | undefined,
  watcher: null as IPSWWatcher | null,
  linkManager: null as IPSWHardLinkManager | null,
  cleanupManager: null as IPSWCleanupManager | null,
  splash: undefined as BrowserWindow | undefined,
  mainWindow: undefined as BrowserWindow | undefined,
  isReady: false,
};

export const SPLASH_TIMEOUT_MS = 10_000;
export const UPDATER_INIT_DELAY = 2_000;
export const UPDATER_CHECK_DELAY = 6_000;

export const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = state.mainWindow;
    if (w) {
      if (w.isMinimizable()) w.restore();
      if (!w.isVisible()) w.show();
      w.focus();
    }
  });
}
