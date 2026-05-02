"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppleDevice = void 0;
const usb_1 = require("usb");
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("../config"));
const fs_1 = __importDefault(require("fs"));
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
function getIdevicePath() {
    const isDev = !electron_1.app.isPackaged;
    return isDev
        ? path_1.default.join(__dirname, "..", "..", "..", "resources", "idevice")
        : path_1.default.join(process.resourcesPath, "idevice");
}
const idevicePath = getIdevicePath();
const EXE = process.platform === "win32" ? ".exe" : "";
const ideviceIdPath = path_1.default.join(idevicePath, `idevice_id${EXE}`);
const ideviceInfoPath = path_1.default.join(idevicePath, `ideviceinfo${EXE}`);
const irecoveryPath = path_1.default.join(idevicePath, `irecovery${EXE}`);
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RECOVERY_MODE_PID = 0x1281;
const DFU_MODE_PIDS = [0x1227];
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------
function runCommand(bin, args) {
    return new Promise((resolve, reject) => {
        if (!fs_1.default.existsSync(bin)) {
            return reject(new Error(`Binary not found: ${bin}`));
        }
        (0, child_process_1.execFile)(bin, args, { timeout: 5000 }, (error, stdout, stderr) => {
            if (error)
                reject(new Error(stderr || error.message));
            else
                resolve(stdout.trim());
        });
    });
}
/**
 * Returns ALL currently connected UDIDs reported by idevice_id.
 * Each call is a fresh snapshot — safe to call concurrently.
 */
async function getConnectedUDIDs() {
    try {
        const output = await runCommand(ideviceIdPath, ["-l"]);
        if (!output)
            return [];
        return output.split("\n").map((l) => l.trim()).filter(Boolean);
    }
    catch (err) {
        console.error("[idevice_id] Error:", err);
        return [];
    }
}
async function isDeviceTrusted(udid) {
    try {
        await runCommand(ideviceInfoPath, ["-u", udid, "-k", "DeviceName"]);
        return true;
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Per-device polling controller
// Encapsulates all state for one device's trust-polling lifecycle.
// ---------------------------------------------------------------------------
class DevicePoller {
    key;
    onUdidDiscovered;
    onTrusted;
    onTimeout;
    getCurrentUdid;
    timer = null;
    running = false;
    startTime = Date.now();
    destroyed = false;
    constructor(key, onUdidDiscovered, onTrusted, onTimeout, getCurrentUdid) {
        this.key = key;
        this.onUdidDiscovered = onUdidDiscovered;
        this.onTrusted = onTrusted;
        this.onTimeout = onTimeout;
        this.getCurrentUdid = getCurrentUdid;
    }
    start() {
        this.scheduleNext(0);
    }
    stop() {
        this.destroyed = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    scheduleNext(delayMs) {
        if (this.destroyed)
            return;
        this.timer = setTimeout(() => this.poll(), delayMs);
    }
    /**
     * Sequential poll: never overlaps with itself.
     * Uses setTimeout chain instead of setInterval to avoid concurrent executions.
     */
    async poll() {
        if (this.destroyed || this.running)
            return;
        this.running = true;
        try {
            if (Date.now() - this.startTime > POLL_TIMEOUT_MS) {
                this.stop();
                this.onTimeout(this.getCurrentUdid());
                return;
            }
            const udids = await getConnectedUDIDs();
            if (this.destroyed)
                return;
            // Match UDID to this device:
            // If we already have a UDID, keep using it (stable re-check).
            // If we don't, and there is exactly one new UDID not claimed by
            // another poller, take it. The caller assigns via onUdidDiscovered.
            const currentUdid = this.getCurrentUdid();
            const udid = currentUdid ?? this.resolveUdid(udids);
            if (!udid) {
                // Device not enumerated by libimobiledevice yet, retry
                this.scheduleNext(POLL_INTERVAL_MS);
                return;
            }
            if (!currentUdid) {
                this.onUdidDiscovered(udid);
            }
            const trusted = await isDeviceTrusted(udid);
            if (this.destroyed)
                return;
            if (trusted) {
                console.log(`[${this.key}] Device trusted: ${udid}`);
                this.stop();
                this.onTrusted(udid);
            }
            else {
                console.log(`[${this.key}] Not trusted yet, retrying...`);
                this.scheduleNext(POLL_INTERVAL_MS);
            }
        }
        catch (err) {
            console.error(`[${this.key}] Poll error:`, err);
            if (!this.destroyed)
                this.scheduleNext(POLL_INTERVAL_MS);
        }
        finally {
            this.running = false;
        }
    }
    /**
     * Resolve which UDID belongs to this device from the full list.
     * Subclasses / callers can override this heuristic. Default: single-item list.
     */
    resolveUdid(udids) {
        // Will be replaced by the registry-aware version in AppleDevice below.
        return udids.length === 1 ? udids[0] : null;
    }
    /** Allow AppleDevice to inject a smarter resolver that checks the registry. */
    setUdidResolver(fn) {
        this.resolveUdid = fn;
    }
}
// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------
class AppleDevice {
    /** Primary registry: busNumber-deviceAddress → device info */
    connectedDevices = new Map();
    /** Secondary index: udid → bus key. For fast reverse-lookup. */
    udidToKey = new Map();
    /** Active pollers, keyed by bus key. */
    pollers = new Map();
    window = null;
    /**
     * While the initial scan is running, USB attach events are queued here
     * instead of being processed immediately — prevents duplicate registrations.
     */
    attachQueue = [];
    scanning = false;
    constructor(window) {
        this.window = window ?? null;
        // Register USB listeners before scanning so no attach/detach is ever missed.
        usb_1.usb.on("attach", this.onDeviceConnect.bind(this));
        usb_1.usb.on("detach", this.onDeviceDisconnect.bind(this));
        // Kick off the initial scan asynchronously.
        // Errors are caught internally; the constructor stays synchronous.
        this.scanExistingDevices().catch((err) => console.error("[scan] Initial scan failed:", err));
    }
    /**
     * Scan devices already plugged in before the app started.
     *
     * Strategy:
     *  1. Ask libimobiledevice for all currently visible UDIDs.
     *  2. Walk the USB device list and register every Apple device found.
     *  3. For each UDID that is already trusted → register as NORMAL_READY immediately.
     *  4. For USB devices without a matched UDID (untrusted / not yet enumerated
     *     by libimobiledevice) → start normal trust-polling.
     *  5. After scan completes, flush any attach events that arrived during the scan.
     */
    async scanExistingDevices() {
        console.log("[scan] Scanning for pre-connected Apple devices...");
        this.scanning = true;
        // Snapshot of all UDIDs libimobiledevice can see right now
        const knownUdids = await getConnectedUDIDs();
        // Check trust status for all of them in parallel
        const trustedSet = new Set();
        await Promise.all(knownUdids.map(async (udid) => {
            if (await isDeviceTrusted(udid))
                trustedSet.add(udid);
        }));
        // Walk USB bus — only Apple devices
        const usbDevices = usb_1.usb.getDeviceList().filter((d) => d.deviceDescriptor.idVendor === config_1.default.appleVendorId);
        if (usbDevices.length === 0 && knownUdids.length === 0) {
            console.log("[scan] No pre-connected Apple devices found.");
            return;
        }
        // UDIDs that still need to be matched to a USB device
        const unmatchedUdids = new Set(knownUdids);
        for (const device of usbDevices) {
            const key = this.getDeviceKey(device);
            // Skip if already registered (e.g. attach event fired before scan finished)
            if (this.connectedDevices.has(key))
                continue;
            const usbState = this.getUsbState(device);
            // --- DFU / Recovery: no UDID, register directly ---
            if (usbState === "DFU" || usbState === "RECOVERY") {
                console.log(`[scan] Found ${usbState} device: ${key}`);
                this.connectedDevices.set(key, { udid: null, state: usbState, usbDevice: device });
                this.sendToRenderer("apple-device-connected", { udid: null, state: usbState });
                continue;
            }
            // --- Normal mode: try to match a UDID ---
            // Grab the first unmatched trusted UDID, then fall back to any unmatched UDID.
            const matchedUdid = [...unmatchedUdids].find((u) => trustedSet.has(u)) ??
                [...unmatchedUdids][0] ??
                null;
            if (matchedUdid) {
                unmatchedUdids.delete(matchedUdid);
                if (trustedSet.has(matchedUdid)) {
                    // Already trusted — no polling needed
                    console.log(`[scan] Found trusted device: ${key} (${matchedUdid})`);
                    this.connectedDevices.set(key, {
                        udid: matchedUdid,
                        state: "NORMAL_READY",
                        usbDevice: device,
                    });
                    this.udidToKey.set(matchedUdid, key);
                    // Emit connected + trusted so renderer gets a complete picture
                    this.sendToRenderer("apple-device-connected", {
                        udid: matchedUdid,
                        state: "NORMAL_READY",
                    });
                    this.sendToRenderer("apple-device-trusted", { udid: matchedUdid });
                }
                else {
                    // Visible to libimobiledevice but not yet trusted
                    console.log(`[scan] Found untrusted device: ${key} (${matchedUdid})`);
                    this.connectedDevices.set(key, {
                        udid: matchedUdid,
                        state: "NORMAL_UNTRUSTED",
                        usbDevice: device,
                    });
                    this.udidToKey.set(matchedUdid, key);
                    this.sendToRenderer("apple-device-connected", {
                        udid: matchedUdid,
                        state: "NORMAL_UNTRUSTED",
                    });
                    this.startTrustPolling(key);
                }
            }
            else {
                // USB device visible but libimobiledevice hasn't enumerated it yet
                console.log(`[scan] Found unenumerated device: ${key}, starting poll...`);
                this.connectedDevices.set(key, {
                    udid: null,
                    state: "NORMAL_UNTRUSTED",
                    usbDevice: device,
                });
                this.startTrustPolling(key);
            }
        }
        // Edge case: libimobiledevice knows UDIDs that have no matching USB entry
        // (can happen with Wi-Fi pairing). Register them with a synthetic key.
        for (const udid of unmatchedUdids) {
            const key = `wifi-${udid}`;
            if (this.udidToKey.has(udid))
                continue;
            const state = trustedSet.has(udid) ? "NORMAL_READY" : "NORMAL_UNTRUSTED";
            console.log(`[scan] Found Wi-Fi device: ${udid} (${state})`);
            // usb.Device is not available for Wi-Fi; cast to satisfy the type
            this.connectedDevices.set(key, { udid, state, usbDevice: null });
            this.udidToKey.set(udid, key);
            this.sendToRenderer("apple-device-connected", { udid, state });
            if (state === "NORMAL_READY") {
                this.sendToRenderer("apple-device-trusted", { udid });
            }
        }
        console.log(`[scan] Done. ${this.connectedDevices.size} device(s) registered.`);
        // Flush attach events that arrived while the scan was running.
        this.scanning = false;
        const queued = this.attachQueue.splice(0);
        for (const device of queued) {
            const key = this.getDeviceKey(device);
            if (!this.connectedDevices.has(key)) {
                // Not already registered by scan → process normally
                await this.onDeviceConnect(device);
            }
            else {
                console.log(`[scan] Skipping queued attach for already-registered device: ${key}`);
            }
        }
    }
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    getDeviceKey(device) {
        return `${device.busNumber}-${device.deviceAddress}`;
    }
    sendToRenderer(event, payload) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send(event, payload);
        }
    }
    getUsbState(device) {
        const pid = device.deviceDescriptor.idProduct;
        if (DFU_MODE_PIDS.includes(pid))
            return "DFU";
        if (pid === RECOVERY_MODE_PID)
            return "RECOVERY";
        return null;
    }
    /** UDIDs already claimed by other devices in this session. */
    claimedUdids() {
        return new Set(this.udidToKey.keys());
    }
    // -------------------------------------------------------------------------
    // Polling lifecycle
    // -------------------------------------------------------------------------
    startTrustPolling(key) {
        if (this.pollers.has(key))
            return; // already polling
        const poller = new DevicePoller(key, 
        // onUdidDiscovered
        (udid) => {
            if (this.udidToKey.has(udid)) {
                // Another device already claimed this UDID — skip
                console.warn(`[${key}] UDID ${udid} already claimed, skipping.`);
                return;
            }
            const info = this.connectedDevices.get(key);
            if (!info)
                return;
            info.udid = udid;
            this.connectedDevices.set(key, info);
            this.udidToKey.set(udid, key);
            this.sendToRenderer("apple-device-connected", { udid, state: "NORMAL_UNTRUSTED" });
        }, 
        // onTrusted
        (udid) => {
            this.pollers.delete(key);
            const info = this.connectedDevices.get(key);
            if (!info)
                return;
            info.state = "NORMAL_READY";
            this.connectedDevices.set(key, info);
            this.sendToRenderer("apple-device-trusted", { udid });
        }, 
        // onTimeout
        (udid) => {
            this.pollers.delete(key);
            const info = this.connectedDevices.get(key);
            if (info) {
                info.state = "NORMAL_UNTRUSTED";
                this.connectedDevices.set(key, info);
            }
            this.sendToRenderer("apple-device-untrusted", { udid, state: "NORMAL_UNTRUSTED" });
        }, 
        // getCurrentUdid
        () => this.connectedDevices.get(key)?.udid ?? null);
        // Inject registry-aware UDID resolver:
        // Pick the first UDID from idevice_id output that is NOT yet claimed.
        poller.setUdidResolver((udids) => {
            const claimed = this.claimedUdids();
            return udids.find((u) => !claimed.has(u)) ?? null;
        });
        this.pollers.set(key, poller);
        poller.start();
    }
    stopPolling(key) {
        const poller = this.pollers.get(key);
        if (poller) {
            poller.stop();
            this.pollers.delete(key);
        }
    }
    // -------------------------------------------------------------------------
    // USB events
    // -------------------------------------------------------------------------
    async onDeviceConnect(device) {
        if (device.deviceDescriptor.idVendor !== config_1.default.appleVendorId)
            return;
        // If the initial scan is still running, defer processing to avoid
        // registering the same physical device twice.
        if (this.scanning) {
            console.log(`[${this.getDeviceKey(device)}] Attach received during scan, queuing...`);
            this.attachQueue.push(device);
            return;
        }
        const key = this.getDeviceKey(device);
        console.log(`[${key}] Apple device connected`);
        const usbState = this.getUsbState(device);
        if (usbState === "DFU" || usbState === "RECOVERY") {
            this.connectedDevices.set(key, { udid: null, state: usbState, usbDevice: device });
            this.sendToRenderer("apple-device-connected", { udid: null, state: usbState });
            return;
        }
        this.connectedDevices.set(key, {
            udid: null,
            state: "NORMAL_UNTRUSTED",
            usbDevice: device,
        });
        // Brief wait for the OS to enumerate the device before polling
        await new Promise((res) => setTimeout(res, 1000));
        // Guard: device may have disconnected during the 1 s wait
        if (!this.connectedDevices.has(key))
            return;
        this.startTrustPolling(key);
    }
    onDeviceDisconnect(device) {
        if (device.deviceDescriptor.idVendor !== config_1.default.appleVendorId)
            return;
        const key = this.getDeviceKey(device);
        const info = this.connectedDevices.get(key);
        console.log(`[${key}] Apple device disconnected`);
        this.stopPolling(key);
        if (info?.udid) {
            this.udidToKey.delete(info.udid);
        }
        this.connectedDevices.delete(key);
        this.sendToRenderer("apple-device-disconnected", {
            udid: info?.udid ?? null,
            state: info?.state ?? null,
        });
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    getDevices() {
        return Array.from(this.connectedDevices.values());
    }
    async runIdeviceCommand(bin, args, udid) {
        const binPath = path_1.default.join(idevicePath, `${bin}${EXE}`);
        const fullArgs = udid ? ["-u", udid, ...args] : args;
        return runCommand(binPath, fullArgs);
    }
    /**
     * Returns the current DeviceState for a given UDID.
     *
     * Priority:
     *  1. Registry (instant, no I/O) — used when the device was detected in
     *     this session via scan or USB attach event.
     *  2. Live detection via resolveStateLive — fallback for devices connected
     *     before the app started and not yet in the registry, or Wi-Fi devices.
     *
     * Throws if the device cannot be found by any method.
     */
    async getDeviceState(udid) {
        // Fast path: already tracked in registry
        const busKey = this.udidToKey.get(udid);
        if (busKey) {
            const info = this.connectedDevices.get(busKey);
            if (info)
                return info.state;
        }
        // Slow path: live detection
        return this.resolveStateLive(udid);
    }
    /**
     * Get device info based on its current state.
     *
     * - NORMAL_READY   → uses ideviceinfo -u <udid> -k <key>
     * - NORMAL_UNTRUSTED → throws: device must be trusted first
     * - RECOVERY / DFU → uses irecovery -q, returns only MODE / PRODUCT / NAME
     *
     * For RECOVERY/DFU the `udid` param is ignored (irecovery talks to
     * whichever device is in recovery/DFU on the bus).
     */
    async getDeviceInfo(udid, key) {
        // Resolve state from registry; fall back to a live USB check.
        const state = await this.getDeviceState(udid);
        switch (state) {
            case "NORMAL_READY":
                return runCommand(ideviceInfoPath, ["-u", udid, "-k", key]);
            case "NORMAL_UNTRUSTED":
                throw new Error(`Device ${udid} is connected but not yet trusted. ` +
                    "Please trust this computer on the device and try again.");
            case "RECOVERY":
            case "DFU":
                return this.getRecoveryInfo(key);
            default:
                throw new Error(`Unknown device state for udid: ${udid}`);
        }
    }
    /**
     * Allowed keys for RECOVERY / DFU mode (irecovery -q output).
     * Any other key is rejected to avoid leaking sensitive identifiers.
     */
    static RECOVERY_ALLOWED_KEYS = new Set(["MODE", "PRODUCT", "NAME"]);
    /**
     * Run `irecovery -q` and extract a single allowed key from the output.
     * Output format per line: `KEY: value`
     */
    async getRecoveryInfo(key) {
        const upperKey = key.toUpperCase();
        if (!AppleDevice.RECOVERY_ALLOWED_KEYS.has(upperKey)) {
            throw new Error(`Key "${key}" is not accessible in RECOVERY/DFU mode. ` +
                `Allowed keys: ${[...AppleDevice.RECOVERY_ALLOWED_KEYS].join(", ")}.`);
        }
        const output = await runCommand(irecoveryPath, ["-q"]);
        for (const line of output.split("\n")) {
            const colonIdx = line.indexOf(":");
            if (colonIdx === -1)
                continue;
            const lineKey = line.slice(0, colonIdx).trim().toUpperCase();
            const lineValue = line.slice(colonIdx + 1).trim();
            if (lineKey === upperKey)
                return lineValue;
        }
        throw new Error(`Key "${key}" not found in irecovery output.`);
    }
    /**
     * Detect device state without a registry entry.
     * Called when getDeviceInfo is used with a udid not tracked in this session
     * (e.g. called before the initial scan finishes, or for a Wi-Fi device).
     *
     * Order of checks:
     *  1. irecovery -m  → reports "Recovery Mode" or "DFU Mode" if applicable
     *  2. ideviceinfo   → trusted normal device
     *  3. idevice_id -l → connected but untrusted
     */
    async resolveStateLive(udid) {
        // 1. Check recovery / DFU via irecovery -m
        try {
            const mode = (await runCommand(irecoveryPath, ["-m"])).toLowerCase();
            if (mode.includes("dfu"))
                return "DFU";
            if (mode.includes("recovery"))
                return "RECOVERY";
        }
        catch {
            // irecovery exits non-zero when no device is in recovery/DFU — that's fine
        }
        // 2. Try to read device info (requires trust)
        try {
            await runCommand(ideviceInfoPath, ["-u", udid, "-k", "DeviceName"]);
            return "NORMAL_READY";
        }
        catch {
            // Falls through to untrusted check
        }
        // 3. Device visible to libimobiledevice but not trusted
        const udids = await getConnectedUDIDs();
        if (udids.includes(udid))
            return "NORMAL_UNTRUSTED";
        throw new Error(`Device ${udid} is not connected or not recognised.`);
    }
    /** Clean up all pollers (call when app is quitting). */
    destroy() {
        for (const poller of this.pollers.values())
            poller.stop();
        this.pollers.clear();
        this.connectedDevices.clear();
        this.udidToKey.clear();
    }
}
exports.AppleDevice = AppleDevice;
