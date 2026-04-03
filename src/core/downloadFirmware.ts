import { AddResult } from "../../global";
import { state } from "../data.js";
import utils from "./utils.js";

type downloadResult = 'success' | 'error' | 'diskFull';

interface downloadOptions {
  continue: boolean
}

class downloadFirmware {
  private minFreeSpace = 5 * 1024 * 1024 * 1024; // 5GB

  constructor() { }

  public async download(firmware: Firmware, device: Device) {
    try {
      const result = await window.downloader.add(firmware, state.currentFolder);

      if (!result.success) {
        console.error(result.error)
      }
    } catch (error) {
      
    }
  }
}

export default new downloadFirmware();