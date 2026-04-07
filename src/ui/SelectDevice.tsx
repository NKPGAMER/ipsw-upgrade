import { useState, useRef, useEffect, useCallback, useMemo, type JSX } from "react";
import type { Task, TaskStatus, Firmware } from "../../global";
import { getDevices, loadModelData } from "../core/dataHandle";
import { getFiles } from "../core/helper";
import { state } from "../data";
import { useLocation, useNavigate } from "react-router-dom";

type CardTask = TaskStatus | "none" | "downloaded" | "old"
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
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ─── Status Mappings ──────────────────────────────────────────────────────────
const STATUS_LABEL: Record<CardTask | "none", string> = {
  none:        "Chưa tải",
  queued:      "Đang chờ",
  downloading: "Đang tải",
  paused:      "Đã tạm dừng",
  completed:   "Đã tải",
  downloaded:  "Đã tải",
  error:       "Lỗi",
  verifying:   "Đang xác minh",
  moving:      "Đang di chuyển",
  old:         "Cần cập nhật"
};

const STATUS_COLOR: Record<CardTask | "none", string> = {
  none:        "text-gray-500",
  queued:      "text-yellow-400",
  downloading: "text-[#137fec]",
  paused:      "text-orange-400",
  completed:   "text-emerald-400",
  downloaded:  "text-emerald-400",
  error:       "text-red-400",
  verifying:   "text-purple-400",
  moving:      "text-cyan-400",
  old:         "text-cyan-400"
};

const STATUS_DOT: Record<CardTask | "none", string> = {
  none:        "bg-gray-600",
  queued:      "bg-yellow-400",
  downloading: "bg-[#137fec]",
  paused:      "bg-orange-400",
  completed:   "bg-emerald-400",
  downloaded:  "bg-emerald-400",
  error:       "bg-red-400",
  verifying:   "bg-purple-400",
  moving:      "bg-cyan-400",
  old:         "bg-cyan-400"
};

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

// ─── DeviceEntry ──────────────────────────────────────────────────────────────
interface DeviceEntry {
  device: Device;
  firmwares: Firmware[];
  task?: Task;
}

// ─── Action type ──────────────────────────────────────────────────────────────
type ControlAction = "download" | "pause" | "resume" | "cancel" | "delete" | "verify" | "redownload";

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, status }: { value: number; status: TaskStatus }) {
  const colors: Partial<Record<TaskStatus, string>> = {
    downloading: "bg-[#137fec]",
    paused:      "bg-orange-400",
    verifying:   "bg-purple-400",
    moving:      "bg-cyan-400",
    completed:   "bg-emerald-400",
    error:       "bg-red-400",
  };
  const color = colors[status] ?? "bg-[#137fec]";
  const animated = status === "downloading" || status === "verifying" || status === "moving";

  return (
    <div className="w-full h-0.75 bg-white/10 rounded-full overflow-hidden mt-2!">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color} ${animated ? "relative overflow-hidden" : ""}`}
        style={{ width: `${value}%` }}
      >
        {animated && (
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        )}
      </div>
    </div>
  );
}

// ─── useCardStatus ────────────────────────────────────────────────────────────
// Hook tái sử dụng để tính status cho một entry, tránh duplicate logic + fetch
function useCardStatus(entry: DeviceEntry): CardTask {
  const [modelFiles, setModelFiles] = useState<IPSWFile[]>([]);

  useEffect(() => {
    getFiles(entry.device.identifier).then(files => setModelFiles(files));
  }, [entry.device.identifier]);

  const latestFw = entry.firmwares[0];
  const inProgress = !!entry.task && ["downloading", "paused", "queued", "verifying", "moving"].includes(entry.task.status);

  if (inProgress) return entry.task!.status as CardTask;
  if (entry.task?.status === "completed") return "completed";
  if (entry.task?.status === "error") return "error";

  if (modelFiles.length > 0 && latestFw) {
    const hasLatest = modelFiles.some(f => f.name.includes(latestFw.buildid));
    return hasLatest ? "downloaded" : "old";
  }

  return entry.task?.status ?? "none";
}

// ─── Device Card ──────────────────────────────────────────────────────────────
function DeviceCard({
  entry,
  selected,
  onClick,
}: {
  entry: DeviceEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const status = useCardStatus(entry);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const latestFw = entry.firmwares[0];
  const inProgress = !!entry.task && ["downloading", "paused", "queued", "verifying", "moving"].includes(entry.task.status);

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(4px)",
        transition: "opacity 0.3s, transform 0.3s, background 0.15s, border-color 0.15s",
      }}
      className={`
        relative cursor-pointer rounded-xl border select-none
        ${selected
          ? "border-[#137fec]/50 bg-[#137fec]/8 shadow-[0_0_0_1px_rgba(19,127,236,0.18)]"
          : "border-white/8 bg-white/4 hover:bg-white/7 hover:border-white/15"
        }
      `}
    >
      {selected && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-[#137fec]" />
      )}

      <div className="p-4! h-40">
        {/* Name + identifier */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5! shrink-0 transition-colors ${selected ? "text-[#137fec]" : "text-gray-500"}`}>
            {PRODUCT_ICON[entry.device.identifier.toLowerCase().split(",")[0] as Product]
              ?? PRODUCT_ICON.iphone}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white truncate leading-snug">
              {entry.device.name}
            </p>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5!">{entry.device.identifier}</p>
          </div>
        </div>

        {/* Version chip */}
        {latestFw && (
          <div className="mt-2.5! flex items-center gap-2">
            <span className="text-[12px] px-2! py-0.5! rounded-md bg-white/5 text-gray-200 font-mono">
              <span className="text-[#137fec] font-bold">{latestFw.version}</span>
            </span>
          </div>
        )}

        {/* Status row */}
        <div className="flex items-center gap-1.5 mt-3!">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]} ${status === "downloading" ? "animate-pulse" : ""}`} />
          <span className={`text-[14px] font-medium ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
          {entry.task?.error && (
            <span className="text-[10px] text-red-400/80 truncate ml-1!" title={entry.task.error}>
              — {entry.task.error}
            </span>
          )}
          {inProgress && (
            <span className="text-[10px] text-gray-500 ml-auto!">{entry.task!.progress}%</span>
          )}
        </div>

        {/* Progress bar */}
        {inProgress && <ProgressBar value={entry.task!.progress} status={status as TaskStatus} />}

        {/* Speed / ETA */}
        {status === "downloading" && entry.task!.speed > 0 && (
          <div className="flex justify-between mt-1.5! text-[10px] text-gray-500">
            <span>{formatBytes(entry.task!.speed)}/s</span>
            {entry.task!.eta && <span>còn {formatEta(entry.task!.eta)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Control Buttons ──────────────────────────────────────────────────────────
function ControlButtons({
  entry,
  status,
  onAction,
}: {
  entry: DeviceEntry;
  status: CardTask;
  onAction: (action: ControlAction, fw?: Firmware) => void;
}) {
  const latestFw = entry.firmwares[0];

  // ── Chưa tải ──
  if (status === "none") {
    return (
      <button
        onClick={() => onAction("download", latestFw)}
        className="w-full py-2.5! rounded-xl bg-[#137fec] hover:bg-[#1a8fff] active:bg-[#0f6fd8] text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20h16" strokeLinecap="round" />
        </svg>
        Download
      </button>
    );
  }

  // ── Cần cập nhật ──
  if (status === "old") {
    return (
      <div className="space-y-2">
        <button
          onClick={() => onAction("download", latestFw)}
          className="w-full py-2.5! rounded-xl bg-cyan-500/12 hover:bg-cyan-500/22 border border-cyan-500/20 text-cyan-300 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 20h16" strokeLinecap="round" />
          </svg>
          Cập nhật lên {latestFw?.version}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => onAction("delete")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors"
          >
            Xoá tệp cũ
          </button>
          <button
            onClick={() => onAction("verify")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors"
          >
            Xác minh
          </button>
        </div>
      </div>
    );
  }

  // ── Đã tải ──
  if (status === "completed" || status === "downloaded") {
    return (
      <div className="space-y-2!">
        <button
          onClick={() => onAction("delete")}
          className="w-full py-2.5! rounded-xl bg-red-500/12 hover:bg-red-500/22 border border-red-500/20 text-red-400 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Xoá tệp
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => onAction("verify")}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors"
          >
            Xác minh
          </button>
          <button
            onClick={() => onAction("redownload", latestFw)}
            className="flex-1 py-2! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[11px] font-medium transition-colors"
          >
            Tải lại
          </button>
        </div>
      </div>
    );
  }

  // ── Lỗi ──
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
            onClick={() => onAction("redownload", latestFw)}
            className="flex-1 py-2.5! rounded-xl bg-[#137fec]/12 hover:bg-[#137fec]/22 border border-[#137fec]/22 text-[#4fa8f5] text-[12px] font-semibold transition-colors"
          >
            Thử lại
          </button>
          <button
            onClick={() => onAction("cancel")}
            className="px-4! py-2.5! rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-[12px] font-semibold transition-colors"
          >
            Huỷ
          </button>
        </div>
      </div>
    );
  }

  // ── Đang tải / Tạm dừng / Đang chờ ──
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
              onClick={() => onAction("pause")}
              className="flex-1 py-2.5! rounded-xl bg-orange-500/12 hover:bg-orange-500/22 border border-orange-500/20 text-orange-300 text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              Tạm dừng
            </button>
          )}
          {(status === "paused" || status === "queued") && (
            <button
              onClick={() => onAction("resume")}
              className="flex-1 py-2.5! rounded-xl bg-[#137fec]/12 hover:bg-[#137fec]/22 border border-[#137fec]/22 text-[#4fa8f5] text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14z" />
              </svg>
              Tiếp tục
            </button>
          )}
          <button
            onClick={() => onAction("cancel")}
            className="px-4! py-2.5! rounded-xl bg-red-500/12 hover:bg-red-500/22 border border-red-500/20 text-red-400 text-[12px] font-semibold transition-colors"
          >
            Huỷ
          </button>
        </div>
      </div>
    );
  }

  // ── Đang xác minh / Di chuyển ──
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
}

// ─── Firmware Table ───────────────────────────────────────────────────────────
function FirmwareTable({
  firmwares,
  onDownload,
}: {
  firmwares: Firmware[];
  onDownload: (fw: Firmware) => void;
}) {
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
                className={`border-b border-white/5 last:border-0 hover:bg-white/4 transition-colors ${
                  i === 0 && page === 0 ? "bg-white/4" : ""
                }`}
              >
                <td className="px-3! py-2!">
                  <span className="text-white font-mono font-medium">{fw.version}</span>
                  <span className="text-gray-600 font-mono ml-1.5 text-[9px]">({fw.buildid})</span>
                </td>
                <td className="px-3! py-2! text-gray-400">{formatDate(fw.releasedate)}</td>
                <td className="px-3! py-2!">
                  {fw.signed
                    ? <span className="text-emerald-400">✓</span>
                    : <span className="text-gray-600">—</span>}
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
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors"
            >
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
  entry,
  product,
  onClose,
  onAction,
}: {
  entry: DeviceEntry;
  product: Product;
  onClose: () => void;
  onAction: (action: ControlAction, fw?: Firmware) => void;
}) {
  const latest = entry.firmwares[0];
  // FIX: tính status một lần duy nhất tại đây, truyền xuống ControlButtons
  const status = useCardStatus(entry);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5! py-3! border-b border-white/8 shrink-0">
        <div className="text-[#137fec] shrink-0">{PRODUCT_ICON[product]}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">{entry.device.name}</p>
          <p className="text-[10px] text-gray-500 font-mono">{entry.device.identifier}</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-gray-500 hover:text-gray-300 flex items-center justify-center transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* ── Main: Latest Firmware ── */}
        <div className="px-5! py-4! border-b border-white/6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-0.75 h-3 rounded-full bg-[#137fec]" />
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Phiên bản mới nhất</p>
          </div>

          {latest ? (
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
                onAction={onAction}
              />
            </>
          ) : (
            <p className="text-[12px] text-gray-500 py-2!">Không có firmware.</p>
          )}
        </div>

        {/* ── Secondary: All Firmwares ── */}
        <div className="px-5! py-4!">
          <div className="flex items-center gap-2 mb-3!">
            <div className="w-0.75 h-3 rounded-full bg-gray-700" />
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Tất cả phiên bản</p>
            <span className="text-[10px] text-gray-600 ml-auto">{entry.firmwares.length} phiên bản</span>
          </div>
          {entry.firmwares.length > 0 ? (
            <FirmwareTable
              firmwares={entry.firmwares}
              onDownload={(fw) => onAction("download", fw)}
            />
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
    <div
      onMouseDown={onMouseDown}
      className="w-4 shrink-0 flex items-center justify-center cursor-col-resize group relative z-10 select-none"
    >
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
  // ── Core state ──
  const [entries, setEntries] = useState<DeviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listWidthPct, setListWidthPct] = useState(44);

  const containerRef = useRef<HTMLDivElement>(null);
  const loadedProductRef = useRef<Product | null>(null);

  const [taskMap, setTaskMap] = useState<Map<string, Task>>(new Map());
  const taskMapRef = useRef<Map<string, Task>>(new Map());
  const location = useLocation();
  const { product } = location.state;
  const navigate = useNavigate()

  const applyTaskMap = useCallback((next: Map<string, Task>) => {
    taskMapRef.current = next;
    setTaskMap(next);
    setEntries(prev => prev.map(e => ({
      ...e,
      task: next.get(e.device.identifier),
    })));
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

  // ── Register downloader events exactly ONCE on mount ──
  useEffect(() => {
    const d = window.downloader;
    if (!d) return;

    const subs = [
      d.onAdded(            (_id, task)       => upsertTask(task)),
      d.onProgress(         (_id, task)       => upsertTask(task)),
      d.onPaused(           (_id, task)       => upsertTask(task)),
      d.onResumed(          (_id, task)       => { if (task) upsertTask(task); }),
      d.onCompleted(        (_id, task)       => upsertTask(task)),
      d.onError(            (_id, _err, task) => upsertTask(task)),
      d.onCancelled(        (id)             => removeTaskById(id)),
      d.onIncompleteDeleted((id)             => removeTaskById(id)),
    ];

    return () => { subs.forEach(s => s.unsubscribe()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load devices + hydrate tasks when product changes ──
  useEffect(() => {
    if (loadedProductRef.current === product) return;
    loadedProductRef.current = product;

    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setSelectedId(null);

    async function load() {
      const devices: Device[] = getDevices().filter(d => d.name.toLocaleLowerCase().startsWith(product)).reverse();

      const built: DeviceEntry[] = await Promise.all(devices.map(async (device) => ({
        device,
        firmwares: (await loadModelData(device.identifier)).firmwares,
        task: undefined,
      })));

      try {
        const activeTasks = await window.downloader.getAllTask();
        const map = new Map<string, Task>();
        for (const t of activeTasks) {
          map.set(t.firmware.identifier, t);
        }
        if (!cancelled) {
          taskMapRef.current = map;
          setTaskMap(map);
          setEntries(built.map(e => ({
            ...e,
            task: map.get(e.device.identifier),
          })));
        }
      } catch (err) {
        console.error("[IPSWManager] Failed to load tasks:", err);
        if (!cancelled) setEntries(built);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [product]);

  // ── Search filter ──
  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      e =>
        e.device.name.toLowerCase().includes(q) ||
        e.device.identifier.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const selectedEntry = useMemo(
    () => entries.find(e => e.device.identifier === selectedId) ?? null,
    [entries, selectedId]
  );

  // ── Resizer ──
  const handleResize = useCallback((dx: number) => {
    if (!containerRef.current) return;
    const totalW = containerRef.current.clientWidth;
    setListWidthPct(prev => Math.max(28, Math.min(72, prev + (dx / totalW) * 100)));
  }, []);

  // ── Downloader actions ──
  // FIX: nhận fw? trực tiếp — không cần fallback phức tạp nữa vì
  //      ControlButtons luôn truyền đúng firmware
  const handleAction = useCallback(async (
    deviceIdentifier: string,
    action: ControlAction,
    fw?: Firmware,
  ) => {
    const d = window.downloader;
    const entry = entries.find(e => e.device.identifier === deviceIdentifier);
    if (!entry) return;

    const task = taskMapRef.current.get(deviceIdentifier);
    const firmware = fw ?? entry.firmwares[0];

    try {
      switch (action) {
        case "download":
        case "redownload": {
          if (!firmware) return;
          await d.add(firmware, state.currentFolder);
          break;
        }
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
          if (task) await d.cancel(task.id);
          break;
        case "verify":
          break;
      }
    } catch (err) {
      console.error(`[IPSWManager] Action "${action}" on ${deviceIdentifier} failed:`, err);
    }
  }, [entries]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-1001">
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
        <div className="flex items-center gap-2 px-31 h-11 border-b border-white/7 shrink-0 bg-[#0e0e12]">
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <span className="text-[16px] font-bold pl-2! text-gray-200 whitespace-nowrap">{entries.length} thiết bị</span>
          </div>

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
                <button
                  onClick={() => setSearch("")}
                  className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => navigate("/")}
              title="Đóng"
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/8 hover:border-red-500/25 text-gray-500 hover:text-red-400 flex items-center justify-center transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Card Grid */}
        <div className="flex-1 overflow-y-auto p-3! scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-gray-600">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
              </svg>
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
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}
            >
              {filtered.map(entry => (
                <DeviceCard
                  key={entry.device.identifier}
                  entry={entry}
                  selected={selectedId === entry.device.identifier}
                  onClick={() =>
                    setSelectedId(prev =>
                      prev === entry.device.identifier ? null : entry.device.identifier
                    )
                  }
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
              onClose={() => setSelectedId(null)}
              onAction={(action, fw) =>
                handleAction(selectedEntry.device.identifier, action, fw)
              }
            />
          </div>
        </>
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .animate-shimmer { animation: shimmer 1.8s linear infinite; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      `}</style>
    </div>
    </div>
  );
}