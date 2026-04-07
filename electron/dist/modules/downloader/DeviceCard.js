"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DeviceCard;
const react_1 = __importDefault(require("react"));
const useDownloadTask_1 = require("./useDownloadTask");
// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(bytes, decimals = 1) {
    if (!bytes)
        return "0 B";
    const k = 1024;
    const s = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(decimals)} ${s[i]}`;
}
// ── Status badge ───────────────────────────────────────────────────────────────
const BADGE = {
    downloaded: { ring: "ring-emerald-500/20 bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", label: "Downloaded" },
    "update-available": { ring: "ring-amber-500/20  bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400", label: "Update Available" },
    uncomplete: { ring: "ring-blue-500/20   bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-400", label: "Incomplete" },
    "not-downloaded": { ring: "ring-zinc-600/20   bg-zinc-800/60", text: "text-zinc-500", dot: "bg-zinc-600", label: "Not Downloaded" },
    unsigned: { ring: "ring-red-500/20    bg-red-500/10", text: "text-red-400", dot: "bg-red-500", label: "Unsigned" },
};
function StatusBadge({ status }) {
    const b = BADGE[status];
    return (<span className={`
        shrink-0 inline-flex items-center gap-1 px-2 py-[3px]
        rounded-full ring-1 text-[9px] font-bold uppercase tracking-widest
        ${b.ring} ${b.text}
      `}>
      <span className={`w-[5px] h-[5px] rounded-full ${b.dot}`}/>
      {b.label}
    </span>);
}
// ── Progress bar ───────────────────────────────────────────────────────────────
const BAR = {
    downloading: "from-[#137fec] to-sky-300",
    queued: "from-zinc-600 to-zinc-400",
    paused: "from-amber-500 to-yellow-400",
    verifying: "from-violet-500 to-purple-400",
    moving: "from-teal-500 to-cyan-400",
    error: "from-red-600 to-rose-400",
};
const LABEL = {
    downloading: "Downloading",
    queued: "Queued",
    paused: "Paused",
    verifying: "Verifying",
    moving: "Moving",
    error: "Error",
};
function ProgressSection({ task }) {
    const pct = Math.min(100, Math.max(0, task.progress ?? 0));
    const bar = BAR[task.status] ?? "from-zinc-600 to-zinc-500";
    const animated = task.status === "downloading" || task.status === "verifying" || task.status === "moving";
    return (<div className="mt-2.5 space-y-1.5">
      {/* Row: label · bytes · speed · pct */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono leading-none">
        <div className="flex items-center gap-1.5 text-zinc-500">
          {animated && (<span className="w-1 h-1 rounded-full bg-[#137fec] animate-pulse"/>)}
          <span className="text-zinc-400">{LABEL[task.status] ?? task.status}</span>
          {task.downloaded != null && task.total != null && (<>
              <span className="text-zinc-700">·</span>
              <span>{fmt(task.downloaded)} / {fmt(task.total)}</span>
            </>)}
        </div>
        <div className="flex items-center gap-1.5">
          {task.speed != null && task.status === "downloading" && (<span className="text-[#137fec]">{fmt(task.speed)}/s</span>)}
          <span className="text-zinc-300 font-semibold tabular-nums">
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Track */}
      <div className="relative h-[3px] w-full rounded-full bg-zinc-800/80 overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${bar} transition-[width] duration-300 ease-out relative overflow-hidden`} style={{ width: `${pct}%` }}>
          {animated && (<span className="absolute inset-0" style={{
                background: "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.28) 50%,transparent 100%)",
                animation: "shimmer 1.6s ease-in-out infinite",
                backgroundSize: "200% 100%",
            }}/>)}
        </div>
      </div>
    </div>);
}
// ── DeviceCard ─────────────────────────────────────────────────────────────────
function DeviceCard({ device, firmware, status, statusText, index = 0, onClick, }) {
    const task = (0, useDownloadTask_1.useDownloadTask)(firmware.url);
    const hasTask = task !== null;
    // Override badge status when a task is active
    const badgeStatus = hasTask && task.status === "error" ? "uncomplete" :
        hasTask ? "uncomplete" :
            status;
    return (<div className={`
        product-card group relative
        bg-[#0e1720] border rounded-xl p-3.5 cursor-pointer select-none
        transition-all duration-200
        hover:bg-[#111e2b]
        ${hasTask
            ? "border-[#137fec]/30 shadow-[0_0_0_1px_rgba(19,127,236,0.12),0_4px_24px_rgba(19,127,236,0.06)]"
            : "border-[#1a2838] hover:border-[#243346]"}
      `} style={{ animationDelay: `${index * 0.04}s` }} onClick={onClick}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="device-name text-[13px] font-semibold text-white truncate leading-snug">
            {device.name}
          </div>
          <div className="device-model text-[10px] text-zinc-600 mt-0.5 font-mono tracking-wide">
            {device.identifier}
          </div>
        </div>
        <StatusBadge status={badgeStatus}/>
      </div>

      {/* Version / active state */}
      <div className="device-version mt-1.5 text-[11px] text-zinc-500 leading-none">
        {hasTask ? (<span className="text-zinc-400">
            iOS {firmware.version}
            <span className="text-zinc-700 mx-1">·</span>
            {firmware.buildid}
          </span>) : (`Version: ${firmware.version}`)}
      </div>

      {/* Progress */}
      {hasTask && <ProgressSection task={task}/>}

      {/* Subtle inner glow on hover */}
      <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-b from-white/[0.018] to-transparent"/>
    </div>);
}
