"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
class DeviceCore {
    devices = new Map();
    interval = null;
    busy = false;
    win;
    constructor(win) {
        this.win = win;
    }
    start(pollInterval = 2000) {
        if (this.interval)
            return;
        this.interval = setInterval(() => {
            this.poll();
        }, pollInterval);
    }
    stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = null;
    }
    async poll() {
        if (this.busy)
            return;
        this.busy = true;
        const newMap = new Map();
        const normalDevices = await this.getNormalDevices();
        for (const udid of normalDevices) {
            const trusted = await this.isTrusted(udid);
            newMap.set(udid, trusted ? "NORMAL_READY" : "NORMAL_UNTRUSTED");
        }
        const recovery = await this.getRecoveryMode();
        if (recovery) {
            newMap.set(recovery.udid, recovery.state);
        }
        this.compareAndEmit(newMap);
        this.devices = newMap;
        this.busy = false;
    }
    compareAndEmit(newMap) {
        // CONNECT / STATE CHANGE
        for (const [udid, state] of newMap) {
            const oldState = this.devices.get(udid);
            if (!oldState) {
                this.emitToRenderer("device:connect", { udid, state });
            }
            else if (oldState !== state) {
                this.emitToRenderer("device:stateChange", {
                    udid,
                    oldState,
                    newState: state
                });
            }
        }
        // DISCONNECT
        for (const udid of this.devices.keys()) {
            if (!newMap.has(udid)) {
                this.emitToRenderer("device:disconnect", { udid });
            }
        }
    }
    emitToRenderer(channel, payload) {
        if (!this.win.isDestroyed()) {
            this.win.webContents.send(channel, payload);
        }
    }
    run(cmd, args) {
        return new Promise((resolve) => {
            const child = (0, child_process_1.spawn)(cmd, args, {
                windowsHide: true,
                shell: false,
                stdio: ["ignore", "pipe", "ignore"]
            });
            let out = "";
            child.stdout.on("data", d => out += d.toString());
            child.on("close", () => resolve(out.trim()));
        });
    }
    async getNormalDevices() {
        const out = await this.run(path_1.default.join(process.resourcesPath, "idevice", "idevice_id.exe"), ["-l"]);
        return out.split("\n").filter(Boolean);
    }
    async isTrusted(udid) {
        const out = await this.run(path_1.default.join(process.resourcesPath, "idevice", "ideviceinfo.exe"), ["-u", udid, "-k", "ProductType"]);
        return !out.includes("ERROR");
    }
    async getRecoveryMode() {
        const out = await this.run(path_1.default.join(process.resourcesPath, "idevice", "irecovery.exe"), ["-q"]);
        if (!out)
            return null;
        if (out.includes("DFU"))
            return { udid: "recovery-device", state: "DFU" };
        return { udid: "recovery-device", state: "RECOVERY" };
    }
    info = {
        GetProductType: () => this.run("ideviceinfo.exe", ['-k'])
    };
}
exports.default = DeviceCore;
