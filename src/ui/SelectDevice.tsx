import { useState, useRef, useEffect, useCallback, useMemo, memo, type JSX } from "react";
import type { Task, TaskStatus, Firmware } from "../../global";
import { download, deleteFile, parseIPSW, getFileNameFromUrl, updateFirmware, getRedundantFilesFromProduct } from "../core/helper";
import { state } from "../data";
import { useLocation, useNavigate } from "react-router-dom";
import { ToastContainer, pushToast } from "./Toast";
import { ProductId } from "./home";
import { ipswClient } from "..";
import type { IncompleteTaskClient } from "../core/ipswClient";
import type { BulkUpdateItem } from "./BulkUpdateManager";
import utils from "../core/utils";

type CardTask = TaskStatus | "none" | "downloaded" | "old" | "corrupted" | "incomplete_dl"

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function formatEta(sec?: number): string {
  if (!sec || sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

// ─── Status Mappings ──────────────────────────────────────────────────────────
const STATUS_LABEL: Record<CardTask | "none", string> = {
  none: "Chưa tải", queued: "Đang chờ", downloading: "Đang tải",
  paused: "Đã tạm dừng", completed: "Đã tải", downloaded: "Đã tải",
  error: "Lỗi", verifying: "Đang xác minh", moving: "Đang di chuyển",
  old: "Có phiên bản mới", corrupted: "Không hoàn chỉnh",
  incomplete_dl: "Chưa tải xong",
};

const STATUS_COLOR: Record<CardTask | "none", string> = {
  none: "text-gray-500", queued: "text-yellow-400", downloading: "text-[#137fec]",
  paused: "text-orange-400", completed: "text-emerald-400", downloaded: "text-emerald-400",
  error: "text-red-400", verifying: "text-purple-400", moving: "text-cyan-400",
  old: "text-cyan-400", corrupted: "text-amber-400", incomplete_dl: "text-sky-400",
};

const TASKBAR_ICON: Record<string, JSX.Element> = {
  download: (
    <svg viewBox="0 0 304 384" className="size-5">
      <path fill="currentColor" d="M299 128L149 277L0 128h85V0h128v128h86zM0 320h299v43H0v-43z"></path>
    </svg>
  ),

  delete: (
    <svg viewBox="0 0 304 384" className="size-5">
      <path fill="currentColor" d="M21 341V85h256v256q0 18-12.5 30.5T235 384H64q-18 0-30.5-12.5T21 341zM299 21v43H0V21h75L96 0h107l21 21h75z"></path>
    </svg>
  ),

  update: (
    <svg viewBox="0 0 32 32" className="size-5" fill="currentColor">
      <path d="M21,24H11a2,2,0,0,0-2,2v2a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V26A2,2,0,0,0,21,24Z" />
      <path d="M28.707,14.293l-12-12a1,1,0,0,0-1.414,0l-12,12A1,1,0,0,0,4,16H9v4a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V16h5a1,1,0,0,0,.707-1.707Z" />
    </svg>
  ),

  close: (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

// ─── Product Icons ────────────────────────────────────────────────────────────
const PRODUCT_ICON: Record<Product, JSX.Element> = {
  iphone: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
      <line x1="9" y1="5" x2="15" y2="5" strokeLinecap="round" />
    </svg>
  ),
  ipad: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="18" height="20" rx="3" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  watch: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="7" y="7" width="10" height="10" rx="3" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M9 17v2.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V17" />
    </svg>
  ),
  mac: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M7 21h10M12 17v4" />
    </svg>
  ),
  tv: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 19v2" />
    </svg>
  ),
  homepod: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3C8.5 3 6 6 6 10c0 5 3 9 6 11 3-2 6-6 6-11 0-4-2.5-7-6-7z" />
    </svg>
  ),
  ipod: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <circle cx="12" cy="16" r="2.5" />
      <rect x="9" y="5" width="6" height="4" rx="1" />
    </svg>
  ),
  realitydevice: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8s3-4 10-4 10 4 10 4v4s-3 4-10 4-10-4-10-4z" />
      <ellipse cx="8.5" cy="10" rx="3" ry="3.5" />
      <ellipse cx="15.5" cy="10" rx="3" ry="3.5" />
    </svg>
  ),
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface DeviceEntry {
  device: Device;
  firmwares: Firmware[] | null;
  task?: Task;
}

type ControlAction =
  | "download" | "pause" | "resume" | "cancel"
  | "delete" | "verify" | "redownload" | "update"
  | "resume_incomplete" | "delete_incomplete";

// ─── OS Label Mapping ─────────────────────────────────────────────────────────
const OS_LABEL: Record<Product, string> = {
  iphone: "iOS",
  ipad: "iPadOS",
  mac: "macOS",
  watch: "watchOS",
  tv: "tvOS",
  realitydevice: "visionOS",
  homepod: "Version",
  ipod: "iOS",
};

// ─── Status Config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<CardTask | "none", {
  label: string;
  pill: string;
  dot: string;
  text: string;
  animate?: boolean;
}> = {
  none: { label: "Chưa tải", pill: "bg-gray-500/15", dot: "bg-gray-500", text: "text-gray-400" },
  queued: { label: "Đang chờ", pill: "bg-yellow-400/12", dot: "bg-yellow-400", text: "text-yellow-400" },
  downloading: { label: "Đang tải", pill: "bg-[#137fec]/15", dot: "bg-[#137fec]", text: "text-[#137fec]", animate: true },
  paused: { label: "Đã tạm dừng", pill: "bg-orange-400/12", dot: "bg-orange-400", text: "text-orange-400" },
  completed: { label: "Đã tải", pill: "bg-emerald-400/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  downloaded: { label: "Đã tải", pill: "bg-emerald-400/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  error: { label: "Lỗi", pill: "bg-red-400/12", dot: "bg-red-400", text: "text-red-400" },
  verifying: { label: "Đang xác minh", pill: "bg-violet-400/12", dot: "bg-violet-400", text: "text-violet-400", animate: true },
  moving: { label: "Đang di chuyển", pill: "bg-cyan-400/10", dot: "bg-cyan-400", text: "text-cyan-400", animate: true },
  old: { label: "Có phiên bản mới", pill: "bg-cyan-400/10", dot: "bg-cyan-400", text: "text-cyan-400" },
  corrupted: { label: "Không hoàn chỉnh", pill: "bg-amber-400/12", dot: "bg-amber-400", text: "text-amber-400" },
  incomplete_dl: { label: "Chưa tải xong", pill: "bg-sky-400/12", dot: "bg-sky-400", text: "text-sky-400" },
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, status }: { value: number; status: TaskStatus | "incomplete_dl" }) {
  const colorMap: Partial<Record<string, string>> = {
    downloading: "bg-[#137fec]",
    paused: "bg-orange-400",
    verifying: "bg-violet-400",
    moving: "bg-cyan-400",
    completed: "bg-emerald-400",
    error: "bg-red-400",
    incomplete_dl: "bg-sky-400",
  };
  const color = colorMap[status] ?? "bg-[#137fec]";
  const animated = ["downloading", "verifying", "moving"].includes(status);

  return (
    <div className="w-full h-1 bg-white/8 rounded-full overflow-hidden mt-2.5!">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color} ${animated ? "relative overflow-hidden" : ""}`}
        style={{ width: `${value}%` }}
      >
        {animated && (
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
        )}
      </div>
    </div>
  );
}

// ─── Device Name with Marquee ─────────────────────────────────────────────────
const DeviceName = memo(function DeviceName({ name }: { name: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    const inner = innerRef.current;
    if (!track || !inner) return;
    const diff = inner.scrollWidth - track.clientWidth;
    setOverflow(diff > 0 ? diff + 8 : 0);
  }, [name]);

  return (
    <div ref={trackRef} className="w-full overflow-hidden">
      <span
        ref={innerRef}
        title={name}
        style={
          overflow > 0
            ? ({ "--scroll-dist": `-${overflow}px` } as React.CSSProperties)
            : undefined
        }
        className={`
          inline-block whitespace-nowrap text-[17px] font-semibold text-white leading-snug
          ${overflow > 0 ? "group-hover:animate-marquee" : ""}
        `}
      >
        {name}
      </span>
    </div>
  );
});

// ─── Card Skeleton ─────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="px-4! py-4.5! flex flex-col gap-0" style={{ minHeight: 168 }}>
      <div className="flex items-start gap-2.5">
        <div className="w-5 h-5 rounded bg-white/8 animate-pulse mt-0.5! shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5!">
          <div className="h-4.25 w-3/4 rounded bg-white/8 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
      <div className="mt-2!">
        <div className="h-7 w-28 rounded-lg bg-white/6 animate-pulse" />
      </div>
      <div className="mt-1! pt-3!">
        <div className="h-7 w-24 rounded-lg bg-white/5 animate-pulse" />
      </div>
    </div>
  );
}

// ─── computeCardStatus ────────────────────────────────────────────────────────
function computeCardStatus(
  entry: DeviceEntry,
  allFiles: IPSWFile[],
  incompleteTasks: IncompleteTaskClient[],
): CardTask {
  // If a live download task is active, it takes priority
  if (entry.firmwares !== null || entry.task) {
    const inProgress = !!entry.task &&
      ["downloading", "paused", "queued", "verifying", "moving"].includes(entry.task.status);
    if (inProgress) return entry.task!.status as CardTask;
    if (entry.task?.status === "completed") return "completed";
    if (entry.task?.status === "error") return "error";
  }

  if (!entry.firmwares || entry.firmwares.length === 0) {
    return "none";
  }

  const latestFw = entry.firmwares[0];

  // Check for incomplete downloads (tải dở) — only when no active task
  const incompTask = incompleteTasks.find(
    (t) =>
      t.firmware.identifier === entry.device.identifier &&
      t.firmware.buildid === latestFw.buildid
  );
  if (incompTask) return "incomplete_dl";

  if (latestFw?.signed && allFiles.length > 0) {
    const info = parseIPSW(getFileNameFromUrl(latestFw.url));
    if (info) {
      const buildIdMap = new Set(entry.firmwares.map(fw => fw.buildid));
      const deviceFiles = allFiles.filter(file => {
        const parsed = parseIPSW(file.name);
        return parsed?.id === info.id && buildIdMap.has(parsed.build);
      });
      if (deviceFiles.length > 0) {
        const latestFile = deviceFiles.find(f => f.name.includes(latestFw.buildid));
        if (latestFile) {
          // Check if file size matches expected (corrupted / incomplete file on disk)
          if (latestFw.filesize > 0 && latestFile.size < latestFw.filesize) {
            return "corrupted";
          }
          return "downloaded";
        }
        return "old";
      }
    }
  }

  return entry.task?.status ?? "none";
}

// ─── Device Card ──────────────────────────────────────────────────────────────
const DeviceCard = memo(function DeviceCard({
  entry,
  selected,
  allFiles,
  incompleteTasks,
  pending,
  onClick,
  onVisible,
}: {
  entry: DeviceEntry;
  selected: boolean;
  allFiles: IPSWFile[];
  incompleteTasks: IncompleteTaskClient[];
  pending: boolean;
  onClick: () => void;
  onVisible: (identifier: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [flash, setFlash] = useState(false);

  const status = computeCardStatus(entry, allFiles, incompleteTasks);
  const cfg = STATUS_CONFIG[status];

  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !pending) {
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
    }
    prevPending.current = pending;
  }, [pending]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const signalledRef = useRef(false);
  useEffect(() => {
    if (!visible || signalledRef.current || entry.firmwares !== null) return;
    signalledRef.current = true;
    onVisible(entry.device.identifier);
  }, [visible, entry.firmwares, entry.device.identifier, onVisible]);

  const latestFw = entry.firmwares?.[0] ?? null;
  const inProgress = !!entry.task &&
    ["downloading", "paused", "queued", "verifying", "moving"].includes(entry.task.status);

  // Find incomplete task for this device
  const incompTask = latestFw
    ? incompleteTasks.find(
      t => t.firmware.identifier === entry.device.identifier && t.firmware.buildid === latestFw.buildid
    )
    : undefined;

  const product = entry.device.identifier.toLowerCase().startsWith("ipad") ? "ipad"
    : entry.device.identifier.toLowerCase().startsWith("watch") ? "watch"
      : entry.device.identifier.toLowerCase().startsWith("mac") ? "mac"
        : entry.device.identifier.toLowerCase().startsWith("appletv") ? "tv"
          : entry.device.identifier.toLowerCase().startsWith("audioaccessory") ? "homepod"
            : entry.device.identifier.toLowerCase().startsWith("realitydevice") ? "realitydevice"
              : entry.device.identifier.toLowerCase().startsWith("ipod") ? "ipod"
                : "iphone";

  const osLabel = OS_LABEL[product as Product] ?? "Version";
  const firmwaresLoaded = entry.firmwares !== null;

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(5px)",
        transition: "opacity 0.3s, transform 0.3s, background 0.15s, border-color 0.15s",
      }}
      className={`
        group h-50 relative cursor-pointer rounded-[14px] border select-none overflow-hidden
        ${selected
          ? "border-[#137fec]/50 bg-[#137fec]/8 shadow-[0_0_0_1px_rgba(19,127,236,0.18)]"
          : "border-white/8 bg-white/4 hover:bg-white/7 hover:border-white/15"
        }
        ${flash ? "animate-card-flash" : ""}
      `}
    >
      {pending && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-[14px]">
          <Spinner className="w-5 h-5 text-white/60" />
        </div>
      )}

      {selected && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-[#137fec]" />
      )}

      {!firmwaresLoaded ? (
        <CardSkeleton />
      ) : (
        <div className="px-4! py-4.5! flex flex-col gap-0" style={{ minHeight: 168 }}>
          <div className="flex items-start gap-2.5">
            <div className="text-gray-500 mt-0.5! shrink-0">
              {PRODUCT_ICON[product as Product]}
            </div>
            <div className="flex-1 min-w-0">
              <DeviceName name={entry.device.name} />
              <p className="text-[11px] text-gray-400 font-mono mt-0.5! truncate">
                {entry.device.identifier}
              </p>
            </div>
          </div>

          {latestFw && (
            <div className="mt-2!">
              <div className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5! py-1! font-mono text-[13px]">
                <p className="text-gray-200 font-medium tracking-wide">{osLabel}</p>
                <span className="text-[#137fec] font-bold">{latestFw.version}</span>
              </div>
            </div>
          )}

          <div className="mt-1! pt-3! flex items-center justify-between">
            <div className={`inline-flex items-center gap-2 rounded-lg px-3! py-1.5! ${cfg.pill}`}>
              <div
                className={`w-1.75 h-1.75 rounded-full ${cfg.dot} shrink-0 ${cfg.animate ? "animate-pulse" : ""}`}
              />
              <span className={`text-[13px] font-semibold ${cfg.text}`}>{cfg.label}</span>
            </div>

            {inProgress && (
              <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                {entry.task!.progress}%
              </span>
            )}
            {status === "incomplete_dl" && incompTask && (
              <span className="text-[11px] text-sky-500 font-mono tabular-nums">
                {incompTask.progress}%
              </span>
            )}
          </div>

          {status === "error" && entry.task?.error && (
            <p className="text-[11px] text-red-400/75 mt-1.5! truncate" title={entry.task.error}>
              {entry.task.error}
            </p>
          )}

          {inProgress && (
            <>
              <ProgressBar value={entry.task!.progress} status={status as TaskStatus} />
              {status === "downloading" && entry.task!.speed > 0 && (
                <div className="flex justify-between mt-1.5! text-[10px] text-gray-600">
                  <span>{formatBytes(entry.task!.speed)}/s</span>
                  {entry.task!.eta && <span>còn {formatEta(entry.task!.eta)}</span>}
                </div>
              )}
            </>
          )}

          {status === "incomplete_dl" && incompTask && (
            <ProgressBar value={incompTask.progress} status="incomplete_dl" />
          )}
        </div>
      )}
    </div>
  );
});

// ─── Control Buttons ──────────────────────────────────────────────────────────
const ControlButtons = memo(function ControlButtons({
  entry,
  status,
  pendingAction,
  incompTask,
  corruptedFile,
  onAction,
}: {
  entry: DeviceEntry;
  status: CardTask;
  pendingAction: ControlAction | null;
  incompTask?: IncompleteTaskClient;
  corruptedFile?: IPSWFile;
  onAction: (action: ControlAction, fw?: Firmware) => void;
}) {
  const latestFw = entry.firmwares?.[0];
  const busy = pendingAction !== null;

  // ── Chưa tải (none) ──────────────────────────────────────────────────────
  if (status === "none") {
    return (
      <button
        disabled={busy}
        onClick={() => onAction("download", latestFw)}
        className="w-full py-2.5! rounded-xl bg-[#137fec] hover:bg-[#1a8fff] active:bg-[#0f6fd8] disabled:opacity-60 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
      >
        {pendingAction === "download"
          ? <><Spinner /> Đang thêm vào hàng…</>
          : <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 20h16" strokeLinecap="round" />
            </svg>
            Download
          </>
        }
      </button>
    );
  }

  // ── Không hoàn chỉnh (corrupted file on disk) ─────────────────────────────
  if (status === "corrupted") {
    const expectedSize = latestFw?.filesize ?? 0;
    const actualSize = corruptedFile?.size ?? 0;

    return (
      <div className="space-y-2!">
        {/* Info box */}
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3! py-2.5! space-y-1!">
          <p className="text-[11px] text-amber-300 font-semibold">Tệp không hoàn chỉnh</p>
          <p className="text-[10px] text-amber-400/70">
            Kích thước: {formatBytes(actualSize)} / {formatBytes(expectedSize)}
          </p>
          <p className="text-[10px] text-amber-400/60">
            Tệp tải về bị thiếu dữ liệu so với bản gốc.
          </p>
        </div>

        {/* Check if there's a resumable tmp file for this firmware */}
        {incompTask ? (
          /* Has a .tmp cache — offer to complete */
          <div className="space-y-2!">
            <div className="bg-sky-500/8 border border-sky-500/20 rounded-xl px-3! py-2! text-[10px] text-sky-400/80">
              Tìm thấy tệp tải dở ({incompTask.progress}%). Có thể tiếp tục.
            </div>
            <button
              disabled={busy}
              onClick={() => onAction("resume_incomplete")}
              className="w-full py-2.5! rounded-xl bg-sky-500/12 hover:bg-sky-500/22 border border-sky-500/20 text-sky-300 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {pendingAction === "resume_incomplete"
                ? <><Spinner className="w-3.5 h-3.5 text-sky-300" /> Đang tiếp tục…</>
                : <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14z" />
                  </svg>
                  Hoàn thiện tệp tải dở
                </>
              }
            </button>
          </div>
        ) : (
          /* No tmp cache — only redownload or delete */
          <div className="bg-amber-500/6 border border-amber-500/12 rounded-lg px-3! py-2! text-[10px] text-amber-400/60">
            Không tìm thấy cache tải dở. Cần tải lại từ đầu.
          </div>
        )}

        <div className="flex gap-2!">
          <button
            disabled={busy}
            onClick={() => onAction("delete")}
            className="flex-1 py-2! rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/18 text-red-400 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "delete" ? <><Spinner className="w-3 h-3 text-red-400" /> Đang xoá…</> : "Xoá tệp lỗi"}
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("redownload", latestFw)}
            className="flex-1 py-2! rounded-xl bg-[#137fec]/10 hover:bg-[#137fec]/20 border border-[#137fec]/18 text-[#4fa8f5] text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "redownload" ? <><Spinner className="w-3 h-3" /> Đang xử lý…</> : "Tải lại từ đầu"}
          </button>
        </div>
      </div>
    );
  }

  // ── Chưa tải xong (incomplete download in downloader state) ───────────────
  if (status === "incomplete_dl" && incompTask) {
    return (
      <div className="space-y-2!">
        {/* Progress info */}
        <div className="bg-sky-500/8 border border-sky-500/20 rounded-xl px-3! py-2.5! space-y-1.5!">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-sky-300 font-semibold">Tải dở dang</p>
            <span className="font-mono text-[11px] text-sky-400">{incompTask.progress}%</span>
          </div>
          <div className="w-full h-1 bg-white/8 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-400 transition-all"
              style={{ width: `${incompTask.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-sky-400/60">
            {formatBytes(incompTask.downloadedBytes)} / {formatBytes(incompTask.totalSize)}
          </p>
          {!incompTask.tmpExists && (
            <p className="text-[10px] text-amber-400/80">
              ⚠ File cache không tồn tại — sẽ tải lại từ đầu.
            </p>
          )}
        </div>

        <div className="flex gap-2!">
          <button
            disabled={busy}
            onClick={() => onAction("resume_incomplete")}
            className="flex-1 py-2.5! rounded-xl bg-sky-500/12 hover:bg-sky-500/22 border border-sky-500/20 text-sky-300 text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {pendingAction === "resume_incomplete"
              ? <><Spinner className="w-3.5 h-3.5 text-sky-300" /> Đang tiếp tục…</>
              : incompTask.tmpExists
                ? <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14z" />
                  </svg>
                  Tải tiếp
                </>
                : <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 20h16" strokeLinecap="round" />
                  </svg>
                  Tải lại từ đầu
                </>
            }
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("delete_incomplete")}
            className="px-4! py-2.5! rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/18 text-red-400 text-[12px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "delete_incomplete" ? <><Spinner className="w-3 h-3 text-red-400" /> Đang xoá…</> : "Xoá"}
          </button>
        </div>
      </div>
    );
  }

  // ── Có phiên bản mới (old) ────────────────────────────────────────────────
  if (status === "old") {
    return (
      <div className="space-y-2!">
        <button
          disabled={busy}
          onClick={() => onAction("update", latestFw)}
          className="w-full py-2.5! rounded-xl bg-cyan-500/12 hover:bg-cyan-500/22 border border-cyan-500/20 text-cyan-300 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {pendingAction === "download"
            ? <><Spinner className="w-3.5 h-3.5 text-cyan-300" /> Đang thêm…</>
            : <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 20h16" strokeLinecap="round" />
              </svg>
              Cập nhật lên {latestFw?.version}
            </>
          }
        </button>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => onAction("delete")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "delete" ? <><Spinner className="w-3 h-3" /> Đang xoá…</> : "Xoá tệp cũ"}
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("verify")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "verify" ? <><Spinner className="w-3 h-3" /> Đang kiểm tra…</> : "Xác minh"}
          </button>
        </div>
      </div>
    );
  }

  // ── Đã tải xong ───────────────────────────────────────────────────────────
  if (status === "completed" || status === "downloaded") {
    return (
      <div className="space-y-2!">
        <button
          disabled={busy}
          onClick={() => onAction("delete")}
          className="w-full py-2.5! rounded-xl bg-red-500/12 hover:bg-red-500/22 border border-red-500/20 text-red-400 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {pendingAction === "delete"
            ? <><Spinner className="w-3.5 h-3.5 text-red-400" /> Đang xoá…</>
            : <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Xoá tệp
            </>
          }
        </button>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => onAction("verify")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "verify" ? <><Spinner className="w-3 h-3" /> Đang kiểm tra…</> : "Xác minh"}
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("redownload", latestFw)}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "redownload" ? <><Spinner className="w-3 h-3" /> Đang xử lý…</> : "Tải lại"}
          </button>
        </div>
      </div>
    );
  }

  // ── Lỗi (error) ───────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="space-y-2!">
        {entry.task?.error && (
          <p className="text-[11px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3! py-2! break-all">
            {entry.task.error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => onAction("redownload", latestFw)}
            className="flex-1 py-2.5! rounded-xl bg-[#137fec]/12 hover:bg-[#137fec]/22 border border-[#137fec]/22 text-[#4fa8f5] text-[12px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "redownload" ? <><Spinner className="w-3 h-3" /> Đang xử lý…</> : "Thử lại"}
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("cancel")}
            className="px-4! py-2.5! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[12px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "cancel" ? <><Spinner className="w-3 h-3" /> Đang huỷ…</> : "Huỷ"}
          </button>
        </div>
      </div>
    );
  }

  // ── Đang tải / tạm dừng / đang chờ ──────────────────────────────────────
  if (["downloading", "paused", "queued"].includes(status)) {
    return (
      <div className="space-y-2!">
        <div className="bg-white/4 rounded-xl p-3! border border-white/6 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</span>
            <span className="text-white font-semibold">{entry.task!.progress}%</span>
          </div>
          <ProgressBar value={entry.task!.progress} status={status as TaskStatus} />
          {status === "downloading" && entry.task!.speed > 0 && (
            <div className="flex justify-between text-[10px] text-gray-500 pt-0.5!">
              <span>{formatBytes(entry.task!.speed)}/s</span>
              {entry.task!.eta && <span>còn {formatEta(entry.task!.eta)}</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {status === "downloading" && (
            <button
              disabled={busy}
              onClick={() => onAction("pause")}
              className="flex-1 py-2.5! rounded-xl bg-orange-500/12 hover:bg-orange-500/22 border border-orange-500/20 text-orange-300 text-[12px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {pendingAction === "pause"
                ? <><Spinner className="w-3.5 h-3.5 text-orange-300" /> Đang tạm dừng…</>
                : <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                  Tạm dừng
                </>
              }
            </button>
          )}
          {status === "paused" && (
            <button
              disabled={busy}
              onClick={() => onAction("resume")}
              className="flex-1 py-2.5! rounded-xl bg-[#137fec]/12 hover:bg-[#137fec]/22 border border-[#137fec]/22 text-[#4fa8f5] text-[12px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {pendingAction === "resume"
                ? <><Spinner className="w-3.5 h-3.5" /> Đang tiếp tục…</>
                : <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14z" />
                  </svg>
                  Tiếp tục
                </>
              }
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => onAction("cancel")}
            className="px-4! py-2.5! rounded-xl bg-red-500/12 hover:bg-red-500/22 border border-red-500/20 text-red-400 text-[12px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "cancel" ? <><Spinner className="w-3 h-3 text-red-400" /> Đang huỷ…</> : "Huỷ"}
          </button>
        </div>
      </div>
    );
  }

  // ── Đang xác minh / di chuyển ─────────────────────────────────────────────
  if (status === "verifying" || status === "moving") {
    return (
      <div className="bg-white/4 rounded-xl p-3! border border-white/6 space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className={STATUS_COLOR[status]}>{STATUS_LABEL[status]}…</span>
          <span className="text-white font-semibold">{entry.task?.progress ?? 0}%</span>
        </div>
        <ProgressBar value={entry.task?.progress ?? 0} status={status as TaskStatus} />
      </div>
    );
  }

  return null;
});

// ─── Firmware Table ───────────────────────────────────────────────────────────
function FirmwareTable({ firmwares, onDownload }: { firmwares: Firmware[]; onDownload: (fw: Firmware) => void }) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 5;
  const totalPages = Math.ceil(firmwares.length / PER_PAGE);
  const items = firmwares.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-white/8">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/8 bg-white/3">
              <th className="text-left px-3! py-2! text-gray-500 font-medium">Phiên bản</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">Phát hành</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">Signed</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">Kích thước</th>
              <th className="px-3! py-2!" />
            </tr>
          </thead>
          <tbody>
            {items.map((fw, i) => (
              <tr
                key={fw.buildid}
                className={`border-b border-white/5 last:border-0 hover:bg-white/4 transition-colors ${i === 0 && page === 0 ? "bg-white/4" : ""}`}
              >
                <td className="px-3! py-2!">
                  <span className="text-white font-mono font-medium">{fw.version}</span>
                  <span className="text-gray-600 font-mono ml-1.5 text-[9px]">({fw.buildid})</span>
                </td>
                <td className="px-3! py-2! text-gray-400">{formatDate(fw.releasedate)}</td>
                <td className="px-3! py-2!">
                  {fw.signed ? <span className="text-emerald-400">✓</span> : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-3! py-2! text-gray-400 font-mono">{formatBytes(fw.filesize)}</td>
                <td className="px-3! py-2!">
                  <button
                    onClick={() => onDownload(fw)}
                    className="px-2.5! py-1! rounded-lg bg-[#137fec]/12 hover:bg-[#137fec]/25 text-[#4fa8f5] text-[10px] font-semibold border border-[#137fec]/20 transition-colors"
                  >
                    Tải
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2! px-1!">
          <span className="text-[10px] text-gray-600">Trang {page + 1} / {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  entry, product, allFiles, incompleteTasks, pendingAction, onClose, onAction,
}: {
  entry: DeviceEntry;
  product: Product;
  allFiles: IPSWFile[];
  incompleteTasks: IncompleteTaskClient[];
  pendingAction: ControlAction | null;
  onClose: () => void;
  onAction: (action: ControlAction, fw?: Firmware) => void;
}) {
  const latest = entry.firmwares?.[0] ?? null;
  const status = computeCardStatus(entry, allFiles, incompleteTasks);

  // Find matching incomplete task for this device's latest firmware
  const incompTask = latest
    ? incompleteTasks.find(
      t => t.firmware.identifier === entry.device.identifier && t.firmware.buildid === latest.buildid
    )
    : undefined;

  // Find corrupted file on disk (for "corrupted" status)
  const corruptedFile = useMemo(() => {
    if (status !== "corrupted" || !latest) return undefined;
    const info = parseIPSW(getFileNameFromUrl(latest.url));
    if (!info) return undefined;
    return allFiles.find(f => {
      const parsed = parseIPSW(f.name);
      return parsed?.id === info.id && parsed?.build === latest.buildid;
    });
  }, [status, latest, allFiles]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-5! py-3! border-b border-white/8 shrink-0">
        <div className="text-[#137fec] shrink-0">{PRODUCT_ICON[product]}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">{entry.device.name}</p>
          <p className="text-[10px] text-gray-500 font-mono">{entry.device.identifier}</p>
        </div>
        <button onClick={onClose}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-gray-500 hover:text-gray-300 flex items-center justify-center transition-colors shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-5! py-4! border-b border-white/6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-0.75 h-3 rounded-full bg-[#137fec]" />
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Phiên bản mới nhất</p>
          </div>

          {entry.firmwares === null ? (
            <div className="space-y-3!">
              <div className="bg-white/4 rounded-xl p-4! border border-white/6 animate-pulse">
                <div className="h-8 w-24 rounded bg-white/8 mb-3!" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-12 rounded-lg bg-white/5" />
                  <div className="h-12 rounded-lg bg-white/5" />
                </div>
              </div>
            </div>
          ) : latest ? (
            <>
              <div className="bg-white/4 rounded-xl p-4! border border-white/6 mb-3!">
                <div className="flex items-start justify-between gap-3 mb-3!">
                  <div>
                    <div className="flex items-center gap-2 mb-1!">
                      <span className="text-[22px] font-bold text-white tracking-tight">{latest.version}</span>
                      {latest.signed && (
                        <span className="text-[10px] px-2! py-0.5! rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">
                          Signed
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 font-mono">{latest.buildid}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-semibold text-white">{formatBytes(latest.filesize)}</p>
                    <p className="text-[10px] text-gray-500">{formatDate(latest.releasedate)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/4 rounded-lg p-2">
                    <p className="text-[9px] text-gray-600 mb-0.5">SHA-256</p>
                    <p className="text-[9px] text-gray-500 font-mono truncate" title={latest.sha256sum}>
                      {latest.sha256sum.slice(0, 18)}…
                    </p>
                  </div>
                  <div className="bg-white/4 rounded-lg p-2">
                    <p className="text-[9px] text-gray-600 mb-0.5">MD5</p>
                    <p className="text-[9px] text-gray-500 font-mono truncate" title={latest.md5sum}>
                      {latest.md5sum.slice(0, 18)}…
                    </p>
                  </div>
                </div>
              </div>
              <ControlButtons
                entry={entry}
                status={status}
                pendingAction={pendingAction}
                incompTask={incompTask}
                corruptedFile={corruptedFile}
                onAction={onAction}
              />
            </>
          ) : (
            <p className="text-[12px] text-gray-500 py-2!">Không có firmware.</p>
          )}
        </div>

        <div className="px-5! py-4!">
          <div className="flex items-center gap-2 mb-3!">
            <div className="w-0.75 h-3 rounded-full bg-gray-700" />
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Tất cả phiên bản</p>
            <span className="text-[10px] text-gray-600 ml-auto">
              {entry.firmwares === null ? "…" : `${entry.firmwares.length} phiên bản`}
            </span>
          </div>
          {entry.firmwares === null ? (
            <div className="space-y-1.5!">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg bg-white/4 animate-pulse" />
              ))}
            </div>
          ) : entry.firmwares.length > 0 ? (
            <FirmwareTable firmwares={entry.firmwares} onDownload={(fw) => onAction("download", fw)} />
          ) : (
            <p className="text-[12px] text-gray-500">Không có dữ liệu.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resizer ──────────────────────────────────────────────────────────────────
function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onResize(e.clientX - lastX.current);
      lastX.current = e.clientX;
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize]);

  return (
    <div onMouseDown={onMouseDown}
      className="w-4 shrink-0 flex items-center justify-center cursor-col-resize group relative z-10 select-none">
      <div className="w-px h-full bg-white/8 group-hover:bg-[#137fec]/40 transition-colors" />
      <div className="absolute w-4 h-10 rounded-full bg-white/5 group-hover:bg-[#137fec]/12 border border-white/10 group-hover:border-[#137fec]/28 flex items-center justify-center transition-all">
        <svg className="w-2.5 h-2.5 text-gray-600 group-hover:text-[#137fec] transition-colors" fill="currentColor" viewBox="0 0 8 16">
          <rect x="1" y="3" width="1.5" height="10" rx="0.75" />
          <rect x="5" y="3" width="1.5" height="10" rx="0.75" />
        </svg>
      </div>
    </div>
  );
}

// ─── IPSWManager ──────────────────────────────────────────────────────────────
export default function IPSWManager() {
  const [entries, setEntries] = useState<DeviceEntry[]>([]);
  const [allFiles, setAllFiles] = useState<IPSWFile[]>([]);
  const [incompleteTasks, setIncompleteTasks] = useState<IncompleteTaskClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listWidthPct, setListWidthPct] = useState(65);
  const [pendingActions, setPendingActions] = useState<Map<string, ControlAction>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const loadedProductRef = useRef<Product | null>(null);
  const taskMapRef = useRef<Map<string, Task>>(new Map());
  const entriesRef = useRef<DeviceEntry[]>([]);
  const requestedFwRef = useRef<Set<string>>(new Set());

  const location = useLocation();
  const { product }: { product: ProductId } = location.state;
  const navigate = useNavigate();

  state.currentProduct = product;

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // ── Sync incomplete tasks from ipswClient ────────────────────────────────
  useEffect(() => {
    // Initial load
    setIncompleteTasks(ipswClient.getIncompleteTasks());

    // Subscribe to changes (e.g. when a file is added matching an incomplete task)
    const unsub = ipswClient.onIncompleteTasksChanged((tasks) => {
      setIncompleteTasks([...tasks]);
    });
    return () => unsub();
  }, []);

  // ── Sync allFiles ────────────────────────────────────────────────────────
  useEffect(() => {
    ipswClient.onReload(() => {
      setAllFiles(ipswClient.getFiles());
    });
  }, []);

  const setPending = useCallback((identifier: string, action: ControlAction | null) => {
    setPendingActions(prev => {
      const next = new Map(prev);
      if (action === null) next.delete(identifier);
      else next.set(identifier, action);
      return next;
    });
  }, []);

  const applyTaskMap = useCallback((next: Map<string, Task>) => {
    taskMapRef.current = next;
    setEntries(prev => {
      let changed = false;
      const result = prev.map(e => {
        const newTask = next.get(e.device.identifier);
        if (e.task === newTask) return e;
        changed = true;
        return { ...e, task: newTask };
      });
      return changed ? result : prev;
    });
  }, []);

  const upsertTask = useCallback((task: Task) => {
    const next = new Map(taskMapRef.current);
    next.set(task.firmware.identifier, task);
    applyTaskMap(next);
  }, [applyTaskMap]);

  const removeTaskById = useCallback((taskId: string) => {
    const next = new Map(taskMapRef.current);
    for (const [key, t] of next) {
      if (t.id === taskId) { next.delete(key); break; }
    }
    applyTaskMap(next);
  }, [applyTaskMap]);

  // ── IPC: listen for firmware data ─────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api.onModelData((identifier: string, device: DeviceResponse | null) => {
      setEntries(prev => prev.map(e =>
        e.device.identifier === identifier
          ? { ...e, firmwares: device?.firmwares ?? [] }
          : e
      ));
    });
    return () => unsub();
  }, []);

  const handleCardVisible = useCallback((identifier: string) => {
    if (requestedFwRef.current.has(identifier)) return;
    requestedFwRef.current.add(identifier);
    window.api.requestModelData(identifier);
  }, []);

  // ── Register downloader events ────────────────────────────────────────────
  useEffect(() => {
    const d = window.downloader;
    if (!d) return;

    const subs = [
      d.onAdded((_id, task) => {
        upsertTask(task);
        setPending(task.firmware.identifier, null);
        // Refresh incomplete tasks since we may have just resumed one
        ipswClient.refreshIncompleteTasks().then(() => {
          setIncompleteTasks(ipswClient.getIncompleteTasks());
        });
      }),
      d.onProgress((_id, task) => upsertTask(task)),
      d.onPaused((_id, task) => {
        upsertTask(task);
        setPending(task.firmware.identifier, null);
      }),
      d.onResumed((_id, task) => {
        if (task) {
          upsertTask(task);
          setPending(task.firmware.identifier, null);
        }
      }),
      d.onCompleted((_id, task) => {
        upsertTask(task);
        setPending(task.firmware.identifier, null);
      }),
      d.onError((_id, err, task) => {
        upsertTask(task);
        setPending(task.firmware.identifier, null);
      }),
      d.onCancelled((id) => {
        for (const [identifier, t] of taskMapRef.current) {
          if (t.id === id) {
            setPending(identifier, null);
            break;
          }
        }
        removeTaskById(id);
      }),
      d.onIncompleteDeleted((id) => {
        removeTaskById(id);
        ipswClient.removeIncompleteTask(id);
        setIncompleteTasks(ipswClient.getIncompleteTasks());
      }),
    ];

    return () => { subs.forEach(s => s.unsubscribe()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load devices ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedProductRef.current === product) return;
    loadedProductRef.current = product;

    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setAllFiles([]);
    setSelectedId(null);
    setPendingActions(new Map());
    requestedFwRef.current = new Set();

    async function load() {
      const devices: Device[] = (await window.api.getDevices())
        .filter(d => d.identifier.toLocaleLowerCase().startsWith(product))
        .reverse();

      const [initialFiles, activeTasks] = await Promise.all([
        ipswClient.getFiles(),
        window.downloader.getAllTask().catch(() => [] as Task[]),
      ]);

      if (cancelled) return;

      const taskMap = new Map<string, Task>();
      for (const t of activeTasks) taskMap.set(t.firmware.identifier, t);
      taskMapRef.current = taskMap;

      const builtEntries: DeviceEntry[] = devices.map(device => ({
        device,
        firmwares: null,
        task: taskMap.get(device.identifier),
      }));

      setEntries(builtEntries);
      setAllFiles(initialFiles);
      setIncompleteTasks(ipswClient.getIncompleteTasks());
      setLoading(false);
    }

    load().catch(err => {
      console.error("[IPSWManager] load failed:", err);
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [product]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      e => e.device.name.toLowerCase().includes(q) || e.device.identifier.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const selectedEntry = useMemo(
    () => entries.find(e => e.device.identifier === selectedId) ?? null,
    [entries, selectedId]
  );

  const handleResize = useCallback((dx: number) => {
    if (!containerRef.current) return;
    const totalW = containerRef.current.clientWidth;
    setListWidthPct(prev => Math.max(28, Math.min(72, prev + (dx / totalW) * 100)));
  }, []);

  const handleAction = useCallback(async (
    deviceIdentifier: string,
    action: ControlAction,
    fw?: Firmware,
  ) => {
    const d = window.downloader;
    const entry = entriesRef.current.find(e => e.device.identifier === deviceIdentifier);
    if (!entry) return;

    const task = taskMapRef.current.get(deviceIdentifier);
    const firmware = fw ?? entry.firmwares?.[0];

    setPending(deviceIdentifier, action);

    try {
      switch (action) {
        case "download":
          if (!firmware) { setPending(deviceIdentifier, null); return; }
          {
            const { success } = await download(firmware);
            if (!success) setPending(deviceIdentifier, null);
          }
          break;

        case "redownload":
          if (!firmware) { setPending(deviceIdentifier, null); return; }
          {
            await deleteFile({ identifier: deviceIdentifier });
            const nextMap = new Map(taskMapRef.current);
            nextMap.delete(deviceIdentifier);
            applyTaskMap(nextMap);
            const { success } = await download(firmware);
            if (!success) setPending(deviceIdentifier, null);
          }
          break;

        case "update":
          await deleteFile({ identifier: deviceIdentifier });
          if (firmware) await updateFirmware(firmware);
          break;

        case "pause":
          if (task) await d.pause(task.id);
          break;

        case "resume":
          if (task) await d.resume(task.id);
          break;

        case "cancel":
          if (task) await d.cancel(task.id);
          break;

        case "delete":
          await deleteFile({ identifier: deviceIdentifier });
          {
            const nextMap = new Map(taskMapRef.current);
            nextMap.delete(deviceIdentifier);
            applyTaskMap(nextMap);
          }
          setPending(deviceIdentifier, null);
          pushToast("success", `Đã xoá tệp: ${deviceIdentifier}`);
          break;

        case "verify":
          setPending(deviceIdentifier, null);
          pushToast("info", `Đã làm mới trạng thái: ${deviceIdentifier}`);
          break;

        // ── resume_incomplete: resume a previously interrupted download ──────
        case "resume_incomplete": {
          // Find the incomplete task for this device's latest firmware
          const latestFw = entry.firmwares?.[0];
          const incompTask = latestFw
            ? ipswClient.getIncompleteTasks().find(
              t => t.firmware.identifier === deviceIdentifier && t.firmware.buildid === latestFw.buildid
            )
            : undefined;

          if (!incompTask) {
            // No incomplete task found — just start a fresh download
            if (firmware) {
              // Delete corrupted file first if present
              await deleteFile({ identifier: deviceIdentifier }).catch(() => { });
              const { success } = await download(firmware);
              if (!success) setPending(deviceIdentifier, null);
            } else {
              setPending(deviceIdentifier, null);
            }
            break;
          }

          const result = await d.resumeIncomplete(incompTask.id);
          if (result.success) {
            // Remove from local incomplete list — the "added" event will confirm
            ipswClient.removeIncompleteTask(incompTask.id);
            setIncompleteTasks(ipswClient.getIncompleteTasks());
            // Delete corrupted file if there was one on disk
            await deleteFile({ identifier: deviceIdentifier }).catch(() => { });
          } else {
            setPending(deviceIdentifier, null);
            pushToast("error", `Không thể tiếp tục: ${result.error ?? "unknown"}`);
          }
          break;
        }

        // ── delete_incomplete: delete incomplete download state ───────────────
        case "delete_incomplete": {
          const latestFw = entry.firmwares?.[0];
          const incompTask = latestFw
            ? ipswClient.getIncompleteTasks().find(
              t => t.firmware.identifier === deviceIdentifier && t.firmware.buildid === latestFw.buildid
            )
            : undefined;

          if (incompTask) {
            const result = await d.deleteIncomplete(incompTask.id);
            if (result.success) {
              ipswClient.removeIncompleteTask(incompTask.id);
              setIncompleteTasks(ipswClient.getIncompleteTasks());
              pushToast("success", `Đã xoá tệp tải dở`);
            } else {
              pushToast("error", `Xoá thất bại: ${result.error ?? "unknown"}`);
            }
          }
          setPending(deviceIdentifier, null);
          break;
        }

        default:
          setPending(deviceIdentifier, null);
      }
    } catch (err) {
      console.error(`[IPSWManager] Action "${action}" on ${deviceIdentifier} failed:`, err);
      setPending(deviceIdentifier, null);
      pushToast("error", `Thao tác thất bại: ${String(err)}`);
    }
  }, [setPending, applyTaskMap]);

  return (
    <div className="fixed inset-0 z-1000">
      <div
        ref={containerRef}
        className="flex h-full bg-[#0c0c0f] text-white overflow-hidden"
        style={{ fontFamily: "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif" }}
      >
        {/* ── Grid Panel ── */}
        <div
          className="flex flex-col overflow-hidden shrink-0"
          style={{
            width: selectedEntry ? `${listWidthPct}%` : "100%",
            transition: "width 0.15s ease",
          }}
        >
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3! h-11 border-b border-white/7 shrink-0 bg-[#0e0e12]">
            {/* Left */}
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <span className="text-[16px] font-bold text-gray-200 whitespace-nowrap">{entries.length} thiết bị</span>
            </div>
            {/* Center */}
            <div className="flex-1 flex justify-center px-2!">
              <div className="flex items-center gap-2 px-2.5! py-1.5! rounded-lg bg-white/5 border border-white/8 w-full max-w-xs hover:border-white/15 focus-within:border-[#137fec]/45 transition-colors">
                <svg className="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm thiết bị…"
                  className="flex-1 bg-transparent text-[11px] text-white placeholder-gray-600 outline-none min-w-0"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {/* Right */}
            <div className="flex items-center justify-between gap-1.5 shrink-0">
              <button
                title="Cập nhật tất cả fỉmware"
                className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
                onClick={async () => {
                  // Collect all entries with status "old" — có firmware mới nhưng chỉ có file cũ
                  const oldEntries = entries.filter(e => {
                    const status = computeCardStatus(e, allFiles, incompleteTasks);
                    return status === "old";
                  });

                  if (oldEntries.length === 0) {
                    pushToast("info", "Không có firmware nào cần cập nhật");
                    return;
                  }

                  // Build BulkUpdateItem list
                  const { oldFiles: productOldFiles, duplicateFiles: productDuplicateFiles } =
                    await getRedundantFilesFromProduct(product);

                  const redundantByIdentifier = new Map<string, IPSWFile[]>();
                  [...productOldFiles, ...productDuplicateFiles].forEach(f => {
                    const parsed = parseIPSW(f.name);
                    if (!parsed) return;
                    const id = parsed.id; // e.g. "iPhone14,3"
                    if (!redundantByIdentifier.has(id)) redundantByIdentifier.set(id, []);
                    redundantByIdentifier.get(id)!.push(f);
                  });

                  const seen = new Set();

                  const items: BulkUpdateItem[] = oldEntries
                    .map(e => {
                      const fw = e.firmwares![0]; // latest firmware
                      const oldFiles = redundantByIdentifier.get(e.device.identifier) ?? [];
                      return { firmware: fw, oldFiles };
                    })
                    .filter(it => !!it.firmware)
                    .filter(it => {
                      if (seen.has(it.firmware.url)) return false;

                      seen.add(it.firmware.url)
                      return true;
                    });

                  navigate("/bulk-update", { state: { items, product } });
                }}
              >
                {TASKBAR_ICON.update}
              </button>
              <button
                onClick={async () => {
                  const { oldFiles, duplicateFiles } = await getRedundantFilesFromProduct(product);
                  utils.customConfirm(`Thao tác này sẽ xóa ${oldFiles.length} tệp cũ và ${duplicateFiles.length} têp bị trùng`)
                }}
                title="Xóa tệp không cần thiết"
                className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
              >
                {TASKBAR_ICON.delete}
              </button>
              <button
                onClick={() => navigate("/downloads")}
                title="Tải xuống"
                className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
              >
                {TASKBAR_ICON.download}
              </button>
              <button
                onClick={() => navigate("/")}
                title="Đóng"
                className="w-10 h-8 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/8 hover:border-red-500/25 text-gray-500 hover:text-red-400 flex items-center justify-center transition-all"
              >
                {TASKBAR_ICON.close}
              </button>
            </div>
          </div>

          {/* Card Grid */}
          <div className="flex-1 overflow-y-auto p-3! scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-gray-600">
                <Spinner className="w-4 h-4 text-gray-600" />
                <span className="text-[12px]">Đang tải…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
                <svg className="w-6 h-6 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <span className="text-[12px]">{search ? "Không tìm thấy thiết bị" : "Không có thiết bị"}</span>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}>
                {filtered.map(entry => (
                  <DeviceCard
                    key={entry.device.identifier}
                    entry={entry}
                    selected={selectedId === entry.device.identifier}
                    allFiles={allFiles}
                    incompleteTasks={incompleteTasks}
                    pending={pendingActions.has(entry.device.identifier)}
                    onClick={() => {
                      if (entry.firmwares === null) return;
                      setSelectedId(prev =>
                        prev === entry.device.identifier ? null : entry.device.identifier
                      );
                    }}
                    onVisible={handleCardVisible}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Resizer + Detail Panel ── */}
        {selectedEntry && (
          <>
            <Resizer onResize={handleResize} />
            <div
              className="flex-1 min-w-0 border-l border-white/7 bg-[#0e0e12] overflow-hidden"
              style={{ animation: "slideIn 0.2s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <DetailPanel
                entry={selectedEntry}
                product={product}
                allFiles={allFiles}
                incompleteTasks={incompleteTasks}
                pendingAction={pendingActions.get(selectedEntry.device.identifier) ?? null}
                onClose={() => setSelectedId(null)}
                onAction={(action, fw) => handleAction(selectedEntry.device.identifier, action, fw)}
              />
            </div>
          </>
        )}
      </div>

      <ToastContainer />

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cardFlash {
          0%   { box-shadow: 0 0 0 0 rgba(19,127,236,0); }
          30%  { box-shadow: 0 0 0 3px rgba(19,127,236,0.35); }
          100% { box-shadow: 0 0 0 0 rgba(19,127,236,0); }
        }
        .animate-card-flash { animation: cardFlash 0.6s ease-out; }
        .animate-shimmer { animation: shimmer 1.8s linear infinite; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      `}</style>
    </div>
  );
}