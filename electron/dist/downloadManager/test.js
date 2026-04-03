"use strict";
/**
 * test.ts — Chạy standalone trên Node.js (không cần Electron)
 * npx ts-node src/test.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const DownloadManager_1 = require("./DownloadManager");
// ── Cấu hình test ──────────────────────────────────────────────────────────────
const TEST_URL = "https://updates.cdn-apple.com/2026WinterFCS/fullrestores/047-89691/F4F2DBF0-41AA-4B6E-ABDB-96EAB5D7CE1E/iPhone18,2_26.3.1_23D8133_Restore.ipsw"; // File 100MB công khai, hỗ trợ Range
const DEST_PATH = path.join(os.homedir(), "Downloads", "iPhone18,2_26.3.1_23D8133_Restore.ipsw");
// ── Helpers console ────────────────────────────────────────────────────────────
function formatBytes(b) {
    if (b <= 0)
        return "0 B";
    if (b < 1024)
        return `${b} B`;
    if (b < 1024 ** 2)
        return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3)
        return `${(b / 1024 ** 2).toFixed(2)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
function formatSpeed(bps) {
    return `${formatBytes(bps)}/s`;
}
function formatETA(sec) {
    if (!isFinite(sec) || sec <= 0)
        return "--:--";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function clearLine() {
    process.stdout.write("\r\x1b[K");
}
function renderProgressBar(pct, width = 30) {
    const filled = Math.round((pct / 100) * width);
    return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}
function renderParts(parts) {
    return parts
        .map((p) => `  Part ${String(p.index).padStart(2)}: ${renderProgressBar(p.progress, 20)} ${String(p.progress).padStart(3)}%  ${formatBytes(p.downloaded)} / ${formatBytes(p.endBytes - p.startBytes + 1)}`)
        .join("\n");
}
// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
    console.log("=".repeat(60));
    console.log("  Download Manager — Test");
    console.log("=".repeat(60));
    console.log(`URL      : ${TEST_URL}`);
    console.log(`Lưu vào  : ${DEST_PATH}`);
    console.log("=".repeat(60) + "\n");
    const dm = new DownloadManager_1.DownloadManager({
        maxConcurrent: 3,
        maxParts: 16,
    });
    let lastRender = 0;
    let lastState = "";
    dm.on("event", (event) => {
        const task = event.payload;
        const now = Date.now();
        // Throttle progress render to 4 fps
        if (event.type === "progress" && now - lastRender < 250)
            return;
        lastRender = now;
        // Clear previous lines if we printed parts before
        if (lastState === "downloading" && task.parts?.length > 0) {
            const lines = task.parts.length + 3;
            for (let i = 0; i < lines; i++) {
                process.stdout.write("\x1b[1A\x1b[2K"); // move up + clear line
            }
        }
        switch (event.type) {
            case "state":
                console.log(`\n[STATE] → ${task.state?.toUpperCase()}`);
                if (task.fileSize) {
                    console.log(`[INFO]  Kích thước: ${formatBytes(task.fileSize)}`);
                    console.log(`[INFO]  Range support: ${task.supportsRange ? "✅ Có" : "❌ Không"}`);
                    console.log(`[INFO]  Số part: ${task.parts?.length ?? 0}\n`);
                }
                lastState = task.state ?? "";
                break;
            case "progress":
                lastState = "downloading";
                const totalPct = task.fileSize > 0
                    ? Math.round((task.totalDownloaded / task.fileSize) * 100)
                    : 0;
                console.log(`[TỔNG]  ${renderProgressBar(totalPct)} ${String(totalPct).padStart(3)}%  ${formatBytes(task.totalDownloaded)} / ${formatBytes(task.fileSize)}  | ${formatSpeed(task.speed)}  | ETA: ${formatETA(task.eta)}`);
                console.log(renderParts(task.parts ?? []));
                console.log(""); // spacing
                break;
            case "merge-progress":
                const mp = event.payload.mergeProgress ?? 0;
                clearLine();
                process.stdout.write(`[MERGE] ${renderProgressBar(mp)} ${String(mp).padStart(3)}%`);
                break;
            case "done":
                clearLine();
                console.log("\n" + "=".repeat(60));
                console.log("  ✅ TẢI XUỐNG HOÀN TẤT!");
                console.log(`  Tệp: ${DEST_PATH}`);
                console.log("=".repeat(60));
                process.exit(0);
                break;
            case "error":
                console.error(`\n❌ LỖI: ${task.error}`);
                process.exit(1);
                break;
            case "part-update":
                // Handled by progress render above
                break;
        }
    });
    dm.on("network-offline", () => {
        console.warn("\n⚠️  Mất kết nối mạng — tạm dừng...");
    });
    dm.on("network-online", () => {
        console.log("✅ Có mạng trở lại — tiếp tục tải...");
    });
    // Bắt đầu tải
    const id = dm.add(TEST_URL, DEST_PATH);
    console.log(`[ID]    Task ID: ${id}`);
    console.log(`[INFO]  Đang kiểm tra URL...\n`);
    // Graceful exit
    process.on("SIGINT", async () => {
        console.log("\n\n[EXIT] Đang lưu trạng thái...");
        await dm.onExit();
        console.log("[EXIT] Đã lưu. Có thể tiếp tục lần sau.");
        process.exit(0);
    });
}
main().catch((err) => {
    console.error("Lỗi khởi động:", err);
    process.exit(1);
});
