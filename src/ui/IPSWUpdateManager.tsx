import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import { formatBytes, formatEta, Spinner } from "./shared";
import { useLocation, useNavigate } from "react-router-dom";
import { ipswClient } from "..";
import { parseIPSW, getFileNameFromUrl } from "../core/helper";
import { state as globalState } from "../data";
import { useDownloadStore } from "../stores/download-store";

// ─── Types ────────────────────────────────────────────────────────────────────

type Product =
  | "iphone" | "ipad" | "watch" | "mac"
  | "realitydevice" | "tv" | "homepod" | "ipod";

interface UpdateEntry {
  /** Firmware mới nhất cần tải */
  firmware: Firmware;
  /** Tên thiết bị */
  deviceName: string;
  /** Identifier (iPhone14,3 …) */
  identifier: string;
  /** File cũ cần xóa khi download bắt đầu */
  oldFiles: IPSWFile[];
  /** Nguồn product */
  product: Product;
}

type EntryStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "moving"
  | "completed"
  | "error";

interface EntryState {
  status: EntryStatus;
  progress: number;
  speed: number;
  eta?: number;
  error?: string;
  taskId?: string;
}

interface ScanState {
  phase: "idle" | "scanning" | "done" | "error";
  scanned: number;
  total: number;
  errorMsg?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OS_LABEL: Record<Product, string> = {
  iphone: "iOS", ipad: "iPadOS", watch: "watchOS",
  mac: "macOS", tv: "tvOS", realitydevice: "visionOS",
  homepod: "Version", ipod: "iOS",
};

const PRODUCT_NAME: Record<Product, string> = {
  iphone: "iPhone", ipad: "iPad", watch: "Apple Watch",
  mac: "Mac", tv: "Apple TV", realitydevice: "Vision Pro",
  homepod: "HomePod", ipod: "iPod touch",
};

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<EntryStatus, {
  label: string; pill: string; dot: string; text: string; animate?: boolean;
}> = {
  pending: { label: "Chờ tải", pill: "bg-[#2a2a3a]", dot: "bg-gray-500", text: "text-gray-400" },
  queued: { label: "Trong hàng", pill: "bg-amber-400/10", dot: "bg-amber-400", text: "text-amber-400" },
  downloading: { label: "Đang tải", pill: "bg-[#0d47a1]/20", dot: "bg-[#2196f3]", text: "text-[#2196f3]", animate: true },
  paused: { label: "Tạm dừng", pill: "bg-orange-500/10", dot: "bg-orange-400", text: "text-orange-400" },
  verifying: { label: "Xác minh", pill: "bg-purple-500/12", dot: "bg-purple-400", text: "text-purple-400", animate: true },
  moving: { label: "Di chuyển", pill: "bg-cyan-500/10", dot: "bg-cyan-400", text: "text-cyan-400", animate: true },
  completed: { label: "Hoàn thành", pill: "bg-emerald-500/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  error: { label: "Lỗi", pill: "bg-red-500/10", dot: "bg-red-400", text: "text-red-400" },
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────

const ProgressBar = ({ value, status }: { value: number; status: EntryStatus }) => {
  const clr: Partial<Record<EntryStatus, string>> = {
    downloading: "#2196f3", paused: "#f97316", verifying: "#a855f7",
    moving: "#06b6d4", completed: "#10b981", error: "#ef4444",
  };
  const c = clr[status] ?? "#2196f3";
  const anim = ["downloading", "verifying", "moving"].includes(status);
  return (
    <div className="h-0.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
      <div
        className={`h-full rounded-full transition-all duration-500 relative ${anim ? "overflow-hidden" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: c }}
      >
        {anim && (
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)",
              animation: "shimmer 1.6s linear infinite",
            }}
          />
        )}
      </div>
    </div>
  );
};

// ─── Single row ───────────────────────────────────────────────────────────────

const UpdateRow = memo(function UpdateRow({
  entry,
  index,
  entryState,
  isDragging,
  isOver,
  running,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onRemove,
}: {
  entry: UpdateEntry;
  index: number;
  entryState: EntryState;
  isDragging: boolean;
  isOver: boolean;
  running: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onRemove: (i: number) => void;
}) {
  const cfg = STATUS_CFG[entryState.status];
  const active = ["downloading", "verifying", "moving", "queued"].includes(entryState.status);
  const fw = entry.firmware;
  const osLabel = OS_LABEL[entry.product];

  return (
    <div
      draggable={!running}
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className="group relative select-none mb-2! last:mb-0!"
      style={{
        opacity: isDragging ? 0.35 : 1,
        transform: isDragging ? "scale(0.985)" : "scale(1)",
        transition: "opacity 0.15s, transform 0.15s",
      }}
    >
      {/* Drop indicator line */}
      {isOver && !isDragging && (
        <div
          className="absolute -top-px left-4 right-4 h-0.5 rounded-full z-10"
          style={{ background: "#2196f3" }}
        />
      )}

      <div
        className="flex items-center gap-3 px-3! py-2.5! rounded-xl border transition-all duration-150"
        style={{
          background: isOver && !isDragging
            ? "rgba(33,150,243,0.06)"
            : "rgba(255,255,255,0.025)",
          borderColor: isOver && !isDragging
            ? "rgba(33,150,243,0.3)"
            : "rgba(255,255,255,0.06)",
        }}
      >
        {/* Index */}
        <span
          className="text-[10px] font-mono w-5 text-right shrink-0 tabular-nums"
          style={{ color: "rgba(255,255,255,0.2)" }}
        >
          {index + 1}
        </span>

        {/* Drag handle */}
        {!running && (
          <div
            className="flex flex-col gap-[3px] shrink-0 cursor-grab active:cursor-grabbing"
            style={{ opacity: isDragging ? 1 : 0.2 }}
            title="Kéo để sắp xếp"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-[3px]">
                <div className="w-[3px] h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.7)" }} />
                <div className="w-[3px] h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.7)" }} />
              </div>
            ))}
          </div>
        )}

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-white truncate max-w-[200px]">
              {entry.deviceName}
            </span>
            <span className="text-[10px] font-mono px-1.5! py-0.5! rounded-md" style={{ background: "rgba(33,150,243,0.12)", color: "#64b5f6" }}>
              {osLabel} {fw.version}
            </span>
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
              {fw.buildid}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            {/* Status pill */}
            <div className={`inline-flex items-center gap-1.5 rounded-md px-2! py-0.5! ${cfg.pill}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.animate ? "animate-pulse" : ""}`} />
              <span className={`text-[10px] font-semibold ${cfg.text}`}>{cfg.label}</span>
            </div>

            {/* Progress % */}
            {active && entryState.progress > 0 && (
              <span className="text-[10px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
                {entryState.progress}%
              </span>
            )}

            {/* Speed & ETA */}
            {entryState.status === "downloading" && entryState.speed > 0 && (
              <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                {formatBytes(entryState.speed)}/s
                {entryState.eta ? ` · ${formatEta(entryState.eta)}` : ""}
              </span>
            )}

            {/* Error */}
            {entryState.status === "error" && entryState.error && (
              <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={entryState.error}>
                {entryState.error}
              </span>
            )}

            {/* Old files badge */}
            {entry.oldFiles.length > 0 && entryState.status === "pending" && (
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                · xóa {entry.oldFiles.length} file cũ
              </span>
            )}
          </div>

          {/* Progress bar */}
          {active && (
            <div className="mt-1.5">
              <ProgressBar value={entryState.progress} status={entryState.status} />
            </div>
          )}
        </div>

        {/* File size */}
        <div className="shrink-0 text-right">
          <span className="text-[11px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>
            {formatBytes(fw.filesize)}
          </span>
          {fw.signed && (
            <div
              className="text-[9px] font-semibold mt-0.5! px-1.5! py-0.5! rounded text-center"
              style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}
            >
              SIGNED
            </div>
          )}
        </div>

        {/* Product badge */}
        <div
          className="shrink-0 text-[9px] font-semibold uppercase tracking-widest px-1.5! py-1! rounded-md"
          style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {entry.product.slice(0, 3).toUpperCase()}
        </div>

        {/* Remove button */}
        {!running && entryState.status === "pending" && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}
            title="Bỏ khỏi danh sách"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Scan progress overlay ────────────────────────────────────────────────────

const ScanOverlay = ({ scan, product }: { scan: ScanState; product: Product }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-5">
    <div className="relative">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(33,150,243,0.08)", border: "1px solid rgba(33,150,243,0.15)" }}
      >
        <Spinner className="w-7 h-7 text-[#2196f3]" />
      </div>
    </div>
    <div className="text-center space-y-1!">
      <p className="text-[14px] font-semibold text-white">
        Đang quét {PRODUCT_NAME[product]}…
      </p>
      <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.35)" }}>
        {scan.scanned} / {scan.total || "?"} thiết bị
      </p>
    </div>
  </div>
);

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ product }: { product: Product }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4">
    <div
      className="w-16 h-16 rounded-2xl flex items-center justify-center"
      style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.12)" }}
    >
      <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    <div className="text-center">
      <p className="text-[14px] font-semibold text-white">Tất cả đã cập nhật</p>
      <p className="text-[12px] mt-1!" style={{ color: "rgba(255,255,255,0.3)" }}>
        Không tìm thấy file cũ nào cho {PRODUCT_NAME[product]}
      </p>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export default function IPSWUpdateManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const product: Product = location.state?.product as Product || globalState.currentProduct || "iphone";

  // Entries (gộp từ nhiều product)
  const [entries, setEntries] = useState<UpdateEntry[]>([]);
  const [entryStates, setEntryStates] = useState<Map<string, EntryState>>(new Map());
  const getActiveDownloadUrls = useDownloadStore((state) => state.getActiveDownloadUrls);

  // Scan state
  const [scan, setScan] = useState<ScanState>({ phase: "idle", scanned: 0, total: 0 });

  // Which products have already been scanned
  const scannedProductsRef = useRef<Set<Product>>(new Set());

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Running state
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const subsRef = useRef<{ unsubscribe: () => void }[]>([]);
  const abortRef = useRef(false);
  const entriesRef = useRef<UpdateEntry[]>([]);
  const entryStatesRef = useRef<Map<string, EntryState>>(new Map());
  const currentIdxRef = useRef(-1);

  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => { entryStatesRef.current = entryStates; }, [entryStates]);

  // ── Scan logic ────────────────────────────────────────────────────────────

  const scanProduct = useCallback(async (prod: Product) => {
    if (scannedProductsRef.current.has(prod)) return;
    scannedProductsRef.current.add(prod);

    const downloaderTasks = await window.downloader.getAllTask().catch(() => []);
    const activeUrlSet = new Set([
      ...getActiveDownloadUrls(),
      ...downloaderTasks.map((task) => task.firmware.url),
    ]);

    const allFiles = ipswClient.getFiles().filter((file => file.name.toLocaleLowerCase().startsWith(prod)));
    const devices = await window.api.getDevices(prod);

    if (!devices || devices.length === 0 || allFiles.length === 0) {
      setScan({ phase: "done", scanned: 0, total: 0 });
      return;
    }

    setScan({ phase: "scanning", scanned: 0, total: devices.length });

    const newEntries: UpdateEntry[] = [];
    const seenUrls = new Set<string>();

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];

      try {
        const modelData: DeviceResponse = await window.api.getModelData(d.identifier);

        if (!modelData?.firmwares?.length) {
          setScan((s) => ({ ...s, scanned: i + 1 }));
          continue;
        }

        const latestFw = modelData.firmwares.filter(fw => fw.signed)[0] ?? modelData.firmwares[0];

        if (!latestFw.signed) {
          setScan((s) => ({ ...s, scanned: i + 1 }));
          continue;
        }

        // ✅ Lọc trùng URL ngay từ đầu
        if (seenUrls.has(latestFw.url)) {
          setScan((s) => ({ ...s, scanned: i + 1 }));
          continue;
        }

        const buildIdMap = new Set(
          modelData.firmwares.map((fw) => fw.buildid)
        );

        const fileName = getFileNameFromUrl(latestFw.url);
        const info = parseIPSW(fileName);

        if (!info) {
          setScan((s) => ({ ...s, scanned: i + 1 }));
          continue;
        }

        const deviceFiles = allFiles.filter((file) => {
          const parsed = parseIPSW(file.name);
          return (
            parsed &&
            parsed.id === info.id &&
            buildIdMap.has(parsed.build)
          );
        });

        if (deviceFiles.length === 0) {
          setScan((s) => ({ ...s, scanned: i + 1 }));
          continue;
        }

        const latestFile = deviceFiles.find((file) => {
          const parsed = parseIPSW(file.name);
          return parsed?.build === latestFw.buildid;
        });

        if (latestFile) {
          if (latestFw.filesize > 0 && latestFile.size < latestFw.filesize) {
            // corrupted → vẫn xử lý tiếp
          } else {
            setScan((s) => ({ ...s, scanned: i + 1 }));
            continue;
          }
        }

        // ✅ Check duplicate với entries hiện tại và task đang có trong downloader store
        const alreadyAdded = entriesRef.current.some(
          (e) => e.firmware.url === latestFw.url
        );
        const existsInDownloader = activeUrlSet.has(latestFw.url);

        if (!alreadyAdded && !existsInDownloader) {
          seenUrls.add(latestFw.url);

          newEntries.push({
            firmware: latestFw,
            deviceName: modelData.name,
            identifier: d.identifier,
            oldFiles: deviceFiles,
            product: prod,
          });
        }
      } catch (err) {
        console.error(
          `[IPSWUpdateManager] Failed to process ${d.identifier}:`,
          err
        );
      }

      setScan((s) => ({ ...s, scanned: i + 1 }));
    }

    if (newEntries.length > 0) {
      setEntries((prev) => {
        const existingUrls = new Set(prev.map((e) => e.firmware.url));
        const toAdd = newEntries.filter(
          (e) => !existingUrls.has(e.firmware.url)
        );
        return [...prev, ...toAdd];
      });

      setEntryStates((prev) => {
        const next = new Map(prev);
        for (const e of newEntries) {
          if (!next.has(e.firmware.url)) {
            next.set(e.firmware.url, {
              status: "pending",
              progress: 0,
              speed: 0,
            });
          }
        }
        return next;
      });
    }

    setScan({
      phase: "done",
      scanned: devices.length,
      total: devices.length,
    });
  }, []);

  // Scan khi product thay đổi
  useEffect(() => {
    scanProduct(product);
  }, [product, scanProduct]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const updateState = useCallback((url: string, patch: Partial<EntryState>) => {
    setEntryStates((prev) => {
      const cur = prev.get(url) ?? { status: "pending" as EntryStatus, progress: 0, speed: 0 };
      const next = new Map(prev);
      next.set(url, { ...cur, ...patch });
      return next;
    });
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback((i: number) => setDragIndex(i), []);
  const handleDragEnter = useCallback((i: number) => setOverIndex(i), []);
  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      setEntries((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(overIndex, 0, moved);
        return next;
      });
    }
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, overIndex]);

  const handleRemove = useCallback((i: number) => {
    const removed = entriesRef.current[i];
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
    if (removed) {
      setEntryStates((prev) => {
        const next = new Map(prev);
        next.delete(removed.firmware.url);
        return next;
      });
    }
  }, []);

  // ── Start update ──────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (running) return;

    const pendingEntries = entriesRef.current.filter((e) => {
      const st = entryStatesRef.current.get(e.firmware.url);
      return !st || st.status === "pending";
    });

    if (pendingEntries.length === 0) return;

    abortRef.current = false;
    setRunning(true);

    const d = window.downloader;
    const subs = [
      d.onStarted((id, task) => {
        updateState(task.firmware.url, { status: "downloading", taskId: id, progress: 0 });
      }),
      d.onProgress((_id, task) => {
        updateState(task.firmware.url, {
          status: task.status as EntryStatus,
          progress: task.progress,
          speed: task.speed,
          eta: task.eta,
        });
      }),
      d.onPaused((_id, task) => {
        if (task) updateState(task.firmware.url, { status: "paused" });
      }),
      d.onResumed((_id, task) => {
        if (task) updateState(task.firmware.url, { status: "downloading" });
      }),
      d.onCompleted((_id, task) => {
        if (task) updateState(task.firmware.url, { status: "completed", progress: 100 });
      }),
      d.onError((_id, error, task) => {
        if (task) updateState(task.firmware.url, { status: "error", error });
      }),
    ];

    subsRef.current.forEach((s) => s.unsubscribe());
    subsRef.current = subs;

    const savePath = globalState.currentFolder;
    for (const entry of pendingEntries) {
      updateState(entry.firmware.url, { status: "queued", progress: 0 });
      try {
        const result = await d.add(entry.firmware, { savePath, deleteFiles: entry.oldFiles });
        if (!result.success) {
          updateState(entry.firmware.url, {
            status: "error",
            error: result.error ?? "Không thể thêm vào hàng đợi",
          });
        }
      } catch (err) {
        updateState(entry.firmware.url, { status: "error", error: String(err) });
      }
    }
  }, [running, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subsRef.current.forEach((s) => s.unsubscribe());
    };
  }, []);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let pending = 0, done = 0, failed = 0;
    entryStates.forEach((s) => {
      if (s.status === "completed") done++;
      else if (s.status === "error") failed++;
      else if (s.status === "pending") pending++;
    });
    return { pending, done, failed, total: entries.length };
  }, [entryStates, entries.length]);

  const totalBytes = useMemo(
    () => entries.reduce((s, e) => s + e.firmware.filesize, 0),
    [entries]
  );

  const allDone = stats.done + stats.failed === stats.total && stats.total > 0;
  const hasPending = stats.pending > 0;
  const isScanning = scan.phase === "scanning";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-1000 flex flex-col overflow-hidden"
      style={{
        background: "#0a0a0f",
        fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
        color: "white",
      }}
    >
      {/* ── Top bar ── */}
      <div
        className="shrink-0 flex items-center gap-3 px-4! h-12 border-b"
        style={{ background: "#0d0d14", borderColor: "rgba(255,255,255,0.06)" }}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(33,150,243,0.12)", border: "1px solid rgba(33,150,243,0.2)" }}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#2196f3]" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 20h16" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[14px] font-bold text-white">IPSW Update</span>
          {/* Product badge */}
          <div
            className="text-[10px] font-semibold px-2! py-0.5! rounded-full"
            style={{ background: "rgba(33,150,243,0.1)", color: "#64b5f6", border: "1px solid rgba(33,150,243,0.2)" }}
          >
            {PRODUCT_NAME[product]}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 ml-2!">
          {stats.total > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
              {stats.total} mục · {formatBytes(totalBytes)}
            </span>
          )}
          {stats.done > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ background: "rgba(16,185,129,0.08)", color: "#34d399" }}>
              {stats.done} xong
            </span>
          )}
          {stats.failed > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ background: "rgba(239,68,68,0.08)", color: "#f87171" }}>
              {stats.failed} lỗi
            </span>
          )}
        </div>

        <div className="flex-1" />
        {/* Close */}
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.25)";
            (e.currentTarget as HTMLElement).style.color = "#f87171";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.4)";
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Scan hint bar */}
        {!running && !isScanning && scan.phase === "done" && entries.length > 0 && (
          <div
            className="shrink-0 flex items-center gap-2 px-4! py-2! border-b text-[11px]"
            style={{ borderColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}
          >
            <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M7 16V4m-3 3 3-3 3 3M17 8v12m3-3-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Kéo thả để sắp xếp thứ tự tải · Tổng:{" "}
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{formatBytes(totalBytes)}</span>
          </div>
        )}

        {/* Content area */}
        {isScanning ? (
          <ScanOverlay scan={scan} product={product} />
        ) : scan.phase === "done" && entries.length === 0 ? (
          <EmptyState product={product} />
        ) : (
          <div className="flex-1 overflow-y-auto px-3! py-3! space-y-1.5" style={{ scrollbarWidth: "thin" }}>
            {entries.map((entry, idx) => {
              const st = entryStates.get(entry.firmware.url) ?? {
                status: "pending" as EntryStatus,
                progress: 0,
                speed: 0,
              };
              return (
                <UpdateRow
                  key={entry.firmware.url}
                  entry={entry}
                  index={idx}
                  entryState={st}
                  isDragging={dragIndex === idx}
                  isOver={overIndex === idx}
                  running={running}
                  onDragStart={handleDragStart}
                  onDragEnter={handleDragEnter}
                  onDragEnd={handleDragEnd}
                  onRemove={handleRemove}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {(entries.length > 0 || running) && (
        <div
          className="shrink-0 border-t px-4! py-3! flex items-center gap-3"
          style={{ background: "#0d0d14", borderColor: "rgba(255,255,255,0.06)" }}
        >
          {/* Overall progress bar when running */}
          {running && stats.total > 0 && (
            <div className="flex-1 min-w-0">
              <div
                className="flex justify-between text-[10px] mb-1!"
                style={{ color: "rgba(255,255,255,0.35)" }}
              >
                <span>
                  {stats.done + stats.failed} / {stats.total}
                  {currentIdx >= 0 && ` · ${entries[currentIdx]?.deviceName ?? ""}`}
                </span>
                <span>{Math.round(((stats.done + stats.failed) / stats.total) * 100)}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${((stats.done + stats.failed) / stats.total) * 100}%`,
                    background: "linear-gradient(90deg, #1565c0, #2196f3)",
                  }}
                />
              </div>
            </div>
          )}

          {/* All done message */}
          {!running && allDone && (
            <div className="flex items-center gap-2 flex-1">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.12)" }}
              >
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-emerald-400">Đã hoàn thành tất cả!</span>
            </div>
          )}

          {!running && !allDone && <div className="flex-1" />}

          {/* Running indicator */}
          {running && (
            <div className="flex items-center gap-2 shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Spinner className="w-3.5 h-3.5 text-[#2196f3]" />
              <span className="text-[12px]">Đang xử lý…</span>
            </div>
          )}

          {/* Start button */}
          {!running && hasPending && (
            <button
              onClick={handleStart}
              className="shrink-0 flex items-center gap-2 h-9 px-5! rounded-xl text-[13px] font-bold text-white transition-all duration-150"
              style={{
                background: "linear-gradient(135deg, #1565c0 0%, #2196f3 100%)",
                boxShadow: "0 0 20px rgba(33,150,243,0.25)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 28px rgba(33,150,243,0.4)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(33,150,243,0.25)";
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 20h16" strokeLinecap="round" />
              </svg>
              Bắt đầu cập nhật ({stats.pending})
            </button>
          )}
        </div>
      )}

      {/* CSS */}
      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
      `}</style>
    </div>
  );
}