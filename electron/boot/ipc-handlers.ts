import { app, ipcMain, type OpenDialogOptions, type IpcMainInvokeEvent } from "electron";
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
      case "set": return s.set(key, value);
      case "has": return s.has(key);
      case "delete": return s.delete(key);
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
];

handlers.forEach(([channel, handler]) => ipcMain.handle(channel, handler));
