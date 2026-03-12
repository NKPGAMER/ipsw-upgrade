import { BrowserWindow } from "electron"
import { spawn } from "child_process"
import path from "path"

type DeviceState =
  | "NORMAL_READY"
  | "NORMAL_UNTRUSTED"
  | "RECOVERY"
  | "DFU"

class DeviceCore {
  private devices = new Map<string, DeviceState>()
  private interval: NodeJS.Timeout | null = null
  private busy = false
  private win: BrowserWindow

  constructor(win: BrowserWindow) {
    this.win = win
  }

  start(pollInterval = 2000) {
    if (this.interval) return

    this.interval = setInterval(() => {
      this.poll()
    }, pollInterval)
  }

  stop() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }

  private async poll() {
    if (this.busy) return
    this.busy = true

    const newMap = new Map<string, DeviceState>()

    const normalDevices = await this.getNormalDevices()

    for (const udid of normalDevices) {
      const trusted = await this.isTrusted(udid)
      newMap.set(udid, trusted ? "NORMAL_READY" : "NORMAL_UNTRUSTED")
    }

    const recovery = await this.getRecoveryMode()
    if (recovery) {
      newMap.set(recovery.udid, recovery.state)
    }

    this.compareAndEmit(newMap)

    this.devices = newMap
    this.busy = false
  }

  private compareAndEmit(newMap: Map<string, DeviceState>) {
    // CONNECT / STATE CHANGE
    for (const [udid, state] of newMap) {
      const oldState = this.devices.get(udid)

      if (!oldState) {
        this.emitToRenderer("device:connect", { udid, state })
      } else if (oldState !== state) {
        this.emitToRenderer("device:stateChange", {
          udid,
          oldState,
          newState: state
        })
      }
    }

    // DISCONNECT
    for (const udid of this.devices.keys()) {
      if (!newMap.has(udid)) {
        this.emitToRenderer("device:disconnect", { udid })
      }
    }
  }

  private emitToRenderer(channel: string, payload: any) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload)
    }
  }

  private run(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"]
      })

      let out = ""
      child.stdout.on("data", d => out += d.toString())
      child.on("close", () => resolve(out.trim()))
    })
  }

  private async getNormalDevices(): Promise<string[]> {
    const out = await this.run(
      path.join(process.resourcesPath, "idevice", "idevice_id.exe"),
      ["-l"]
    )
    return out.split("\n").filter(Boolean)
  }

  private async isTrusted(udid: string): Promise<boolean> {
    const out = await this.run(
      path.join(process.resourcesPath, "idevice", "ideviceinfo.exe"),
      ["-u", udid, "-k", "ProductType"]
    )
    return !out.includes("ERROR")
  }

  private async getRecoveryMode():
    Promise<{ udid: string; state: DeviceState } | null> {

    const out = await this.run(
      path.join(process.resourcesPath, "idevice", "irecovery.exe"),
      ["-q"]
    )

    if (!out) return null

    if (out.includes("DFU"))
      return { udid: "recovery-device", state: "DFU" }

    return { udid: "recovery-device", state: "RECOVERY" }
  }

  public info = {
    GetProductType: () => this.run("ideviceinfo.exe", ['-k'])
  }
}

export default DeviceCore