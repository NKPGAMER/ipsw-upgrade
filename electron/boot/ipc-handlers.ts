import { app, ipcMain, type OpenDialogOptions, type IpcMainInvokeEvent, BrowserWindow } from "electron";
import { state, s } from "./app-state";
import { getUpdateStatus } from "./auto-updater";
import { selectFolder, selectFile } from "../utils/system";
import { getAllDisk, getDiskInfo } from "../i10r-addon";

type IpcHandler = [string, (event: IpcMainInvokeEvent, ...args: any[]) => any];

const handlers: IpcHandler[] = [
  ["app:relaunch", () => {
    app.relaunch();
    app.exit(0);
    return { success: true };
  }],

  ["select-folder", () => selectFolder()],

  ["select-file", (_, options?: OpenDialogOptions) => selectFile(options)],

  ["store", (_, method: string, key: string, value?: any) => {
    switch (method) {
      case "get": return s.get(key);
      case "set": {
        const result = s.set(key, value);
        state.mainWindow?.webContents.send("store:changed", key, value);
        return result;
      }
      case "has": return s.has(key);
      case "delete": {
        const result = s.delete(key);
        state.mainWindow?.webContents.send("store:changed", key, undefined);
        return result;
      }
      default:
        console.warn("[store] unknown method:", method);
        return undefined;
    }
  }],

  ["getDiskInfo", (_, targetPath: string) => getDiskInfo(targetPath)],
  ["getAllDisk", () => getAllDisk()],

  ["updater:getStatus", () => getUpdateStatus()],

  ["dh:requestModelData", (_, identifier) => state.dh?.getModelDataForReact(identifier)],
  ["dh:getDeviceModelData", (_, identifier) => state.dh?.get(identifier)],
  ["dh:getDevices", (_, product) => state.dh?.getDevices(product)],
  ["dh:getModelData", (_, identifier) => state.dh?.getModelData(identifier)],

  ["win:minimize", (_) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
    return undefined;
  }],
  ["win:maximize", (_) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
    return undefined;
  }],
  ["win:close", (_) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.close();
    return undefined;
  }],
];

handlers.forEach(([channel, handler]) => ipcMain.handle(channel, handler));
