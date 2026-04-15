import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from "react";
import type { Task, TaskStatus } from "../../global";
import { useLocation, useNavigate } from "react-router-dom";
import { ToastContainer, pushToast } from "./Toast";
import type { ProductId } from "./home";

// ─── Storage key ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "bulk_update_state";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BulkUpdateItem {
  firmware: Firmware;
  /** Files to delete once download starts (old + duplicate) */
  oldFiles: IPSWFile[];
}

interface PersistedState {
  items: BulkUpdateItem[];
  /** Which products have already been merged into the list */
  mergedProducts: string[];
}

type ItemStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "moving"
  | "completed"
  | "error"
  | "skipped";

interface ItemState {
  status: ItemStatus;
  progress: number;
  speed: number;
  eta?: number;
  error?: string;
  taskId?: string;
}

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

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CFG: Record<ItemStatus, {
  label: string;
  pill: string;
  dot: string;
  text: string;
  animate?: boolean;
}> = {
  pending:     { label: "Chờ tải",        pill: "bg-gray-500/15",    dot: "bg-gray-500",    text: "text-gray-400" },
  queued:      { label: "Đang chờ",       pill: "bg-yellow-400/12",  dot: "bg-yellow-400",  text: "text-yellow-400" },
  downloading: { label: "Đang tải",       pill: "bg-[#137fec]/15",   dot: "bg-[#137fec]",   text: "text-[#137fec]", animate: true },
  paused:      { label: "Tạm dừng",       pill: "bg-orange-400/12",  dot: "bg-orange-400",  text: "text-orange-400" },
  verifying:   { label: "Đang xác minh",  pill: "bg-violet-400/12",  dot: "bg-violet-400",  text: "text-violet-400", animate: true },
  moving:      { label: "Đang di chuyển", pill: "bg-cyan-400/10",    dot: "bg-cyan-400",    text: "text-cyan-400", animate: true },
  completed:   { label: "Hoàn thành",     pill: "bg-emerald-400/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  error:       { label: "Lỗi",            pill: "bg-red-400/12",     dot: "bg-red-400",     text: "text-red-400" },
  skipped:     { label: "Bỏ qua",         pill: "bg-gray-500/10",    dot: "bg-gray-600",    text: "text-gray-500" },
};

// ─── ProgressBar ──────────────────────────────────────────────────────────────
function ProgressBar({ value, status }: { value: number; status: ItemStatus }) {
  const colorMap: Partial<Record<ItemStatus, string>> = {
    downloading: "bg-[#137fec]",
    paused:      "bg-orange-400",
    verifying:   "bg-violet-400",
    moving:      "bg-cyan-400",
    completed:   "bg-emerald-400",
    error:       "bg-red-400",
  };
  const color = colorMap[status] ?? "bg-[#137fec]";
  const animated = ["downloading", "verifying", "moving"].includes(status);

  return (
    <div className="w-full h-0.5 bg-white/8 rounded-full overflow-hidden mt-1.5!">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color} ${animated ? "relative overflow-hidden" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      >
        {animated && (
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
        )}
      </div>
    </div>
  );
}

// ─── Drag handle icon ─────────────────────────────────────────────────────────
function DragHandle({ dragging }: { dragging: boolean }) {
  return (
    <div
      className={`flex flex-col gap-0.5 px-1! cursor-grab active:cursor-grabbing shrink-0 ${dragging ? "opacity-100" : "opacity-30 group-hover:opacity-60"} transition-opacity`}
      title="Kéo để sắp xếp"
    >
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="w-3 h-px bg-gray-400 rounded-full" />
      ))}
    </div>
  );
}

// ─── Single row item ──────────────────────────────────────────────────────────
const UpdateRow = memo(function UpdateRow({
  item,
  index,
  itemState,
  isDragging,
  isOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onRemove,
  running,
}: {
  item: BulkUpdateItem;
  index: number;
  itemState: ItemState;
  isDragging: boolean;
  isOver: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onRemove: (i: number) => void;
  running: boolean;
}) {
  const cfg = STATUS_CFG[itemState.status];
  const inProgress = ["downloading", "verifying", "moving", "queued"].includes(itemState.status);
  const fw = item.firmware;

  return (
    <div
      draggable={!running}
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      style={{
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 0.15s, transform 0.15s",
      }}
      className={`
        group relative flex items-center gap-3 px-3! py-2.5! rounded-xl border select-none
        ${isOver && !isDragging ? "border-[#137fec]/50 bg-[#137fec]/5" : "border-white/8 bg-white/4"}
        ${isDragging ? "scale-[0.98]" : ""}
      `}
    >
      {/* Index badge */}
      <span className="text-[10px] text-gray-600 font-mono w-5 text-right shrink-0 tabular-nums">
        {index + 1}
      </span>

      {/* Drag handle — only when not running */}
      {!running && (
        <DragHandle dragging={isDragging} />
      )}

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-white truncate">
            {fw.identifier}
          </span>
          <span className="text-[11px] font-mono text-[#137fec] shrink-0">
            {fw.version}
          </span>
          <span className="text-[10px] font-mono text-gray-600 shrink-0">
            {fw.buildid}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-0.5!">
          {/* Status pill */}
          <div className={`inline-flex items-center gap-1.5 rounded-md px-2! py-0.5! ${cfg.pill}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0 ${cfg.animate ? "animate-pulse" : ""}`} />
            <span className={`text-[11px] font-medium ${cfg.text}`}>{cfg.label}</span>
          </div>

          {/* Progress % when active */}
          {inProgress && itemState.progress > 0 && (
            <span className="text-[11px] text-gray-500 font-mono tabular-nums">
              {itemState.progress}%
            </span>
          )}

          {/* Speed & ETA */}
          {itemState.status === "downloading" && itemState.speed > 0 && (
            <span className="text-[10px] text-gray-600 font-mono">
              {formatBytes(itemState.speed)}/s
              {itemState.eta ? ` · còn ${formatEta(itemState.eta)}` : ""}
            </span>
          )}

          {/* Error message */}
          {itemState.status === "error" && itemState.error && (
            <span className="text-[11px] text-red-400/75 truncate" title={itemState.error}>
              {itemState.error}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {inProgress && <ProgressBar value={itemState.progress} status={itemState.status} />}

        {/* Old files to be deleted */}
        {item.oldFiles.length > 0 && (
          <p className="text-[10px] text-gray-600 mt-0.5! truncate">
            Sẽ xóa: {item.oldFiles.map(f => f.name).join(", ")}
          </p>
        )}
      </div>

      {/* File size */}
      <span className="text-[11px] text-gray-600 font-mono shrink-0 tabular-nums">
        {formatBytes(fw.filesize)}
      </span>

      {/* Signed badge */}
      {fw.signed && (
        <span className="text-[10px] font-medium px-1.5! py-0.5! rounded bg-emerald-400/12 text-emerald-400 border border-emerald-400/20 shrink-0">
          Signed
        </span>
      )}

      {/* Remove button — only when pending and not running */}
      {!running && itemState.status === "pending" && (
        <button
          onClick={() => onRemove(index)}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-6 h-6 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 flex items-center justify-center"
          title="Xóa khỏi danh sách"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
});

// ─── BulkUpdateManager ────────────────────────────────────────────────────────
export default function BulkUpdateManager() {
  const location = useLocation();
  const navigate = useNavigate();

  // Items passed from SelectDevice via navigate()
  const incoming = (location.state as { items?: BulkUpdateItem[]; product?: ProductId } | null);
  const incomingItems: BulkUpdateItem[] = incoming?.items ?? [];
  const incomingProduct: string = incoming?.product ?? "";

  // ── Persisted state ────────────────────────────────────────────────────────
  const [items, setItems] = useState<BulkUpdateItem[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return incomingItems;
      const parsed: PersistedState = JSON.parse(saved);

      // If incoming product was already merged → don't add duplicates
      if (parsed.mergedProducts.includes(incomingProduct)) {
        return parsed.items;
      }

      // Merge new items for a different product into existing list
      const existingIds = new Set(parsed.items.map(i => i.firmware.identifier));
      const merged = [
        ...parsed.items,
        ...incomingItems.filter(i => !existingIds.has(i.firmware.identifier)),
      ];
      return merged;
    } catch {
      return incomingItems;
    }
  });

  const [mergedProducts, setMergedProducts] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return incomingProduct ? [incomingProduct] : [];
      const parsed: PersistedState = JSON.parse(saved);
      if (incomingProduct && !parsed.mergedProducts.includes(incomingProduct)) {
        return [...parsed.mergedProducts, incomingProduct];
      }
      return parsed.mergedProducts;
    } catch {
      return incomingProduct ? [incomingProduct] : [];
    }
  });

  // ── Item states ────────────────────────────────────────────────────────────
  const [itemStates, setItemStates] = useState<Map<string, ItemState>>(() => {
    const m = new Map<string, ItemState>();
    items.forEach(it => m.set(it.firmware.identifier, { status: "pending", progress: 0, speed: 0 }));
    return m;
  });

  // ── Running state ──────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  // ── Drag state ─────────────────────────────────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const subsRef = useRef<{ unsubscribe: () => void }[]>([]);
  const itemsRef = useRef<BulkUpdateItem[]>(items);
  const itemStatesRef = useRef<Map<string, ItemState>>(itemStates);
  const currentIndexRef = useRef<number>(-1);
  const abortRef = useRef(false);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { itemStatesRef.current = itemStates; }, [itemStates]);

  // ── Persist to sessionStorage whenever items/mergedProducts change ─────────
  useEffect(() => {
    try {
      const toSave: PersistedState = { items, mergedProducts };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore quota errors */ }
  }, [items, mergedProducts]);

  // ── Sync new incoming items when product changes ────────────────────────────
  useEffect(() => {
    if (!incomingProduct || !incomingItems.length) return;
    if (mergedProducts.includes(incomingProduct)) return;

    setItems(prev => {
      const existingIds = new Set(prev.map(i => i.firmware.identifier));
      const added = incomingItems.filter(i => !existingIds.has(i.firmware.identifier));
      return [...prev, ...added];
    });
    setItemStates(prev => {
      const next = new Map(prev);
      incomingItems.forEach(it => {
        if (!next.has(it.firmware.identifier)) {
          next.set(it.firmware.identifier, { status: "pending", progress: 0, speed: 0 });
        }
      });
      return next;
    });
    setMergedProducts(prev => [...prev, incomingProduct]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingProduct]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const updateItemState = useCallback((identifier: string, patch: Partial<ItemState>) => {
    setItemStates(prev => {
      const cur = prev.get(identifier) ?? { status: "pending", progress: 0, speed: 0 };
      const next = new Map(prev);
      next.set(identifier, { ...cur, ...patch });
      return next;
    });
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let pending = 0, done = 0, failed = 0, skipped = 0;
    itemStates.forEach(s => {
      if (s.status === "completed") done++;
      else if (s.status === "error") failed++;
      else if (s.status === "skipped") skipped++;
      else if (s.status === "pending") pending++;
    });
    return { pending, done, failed, skipped, total: items.length };
  }, [itemStates, items.length]);

  const totalBytes = useMemo(
    () => items.reduce((s, it) => s + it.firmware.filesize, 0),
    [items]
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((i: number) => setDragIndex(i), []);
  const handleDragEnter = useCallback((i: number) => setOverIndex(i), []);
  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      setItems(prev => {
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
    setItems(prev => prev.filter((_, idx) => idx !== i));
    setItemStates(prev => {
      const next = new Map(prev);
      const identifier = itemsRef.current[i]?.firmware.identifier;
      if (identifier) next.delete(identifier);
      return next;
    });
  }, []);

  // ── Start bulk update ──────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (running || items.length === 0) return;
    abortRef.current = false;
    setRunning(true);

    const d = window.downloader;

    // Register global downloader events once
    const subs = [
      d.onStarted((id, task) => {
        const identifier = task.firmware.identifier;
        updateItemState(identifier, { status: "downloading", taskId: id, progress: 0 });

        // Delete old files as soon as download starts
        const curItems = itemsRef.current;
        const match = curItems.find(it => it.firmware.identifier === identifier);
        if (match?.oldFiles?.length) {
          Promise.all(match.oldFiles.map(f => window.api.deleteFile(f.path).catch(() => null)))
            .then(() => pushToast("success", `Đã xóa ${match.oldFiles.length} tệp cũ cho ${identifier}`))
            .catch(() => {});
        }
      }),

      d.onProgress((_id, task) => {
        updateItemState(task.firmware.identifier, {
          status: "downloading",
          progress: task.progress,
          speed: task.speed,
          eta: task.eta,
        });
      }),

      d.onPaused((_id, task) => {
        updateItemState(task.firmware.identifier, { status: "paused" });
      }),

      d.onResumed((_id, task) => {
        if (task) updateItemState(task.firmware.identifier, { status: "downloading" });
      }),

      d.onCompleted((_id, task) => {
        updateItemState(task.firmware.identifier, { status: "completed", progress: 100 });
        pushToast("success", `Đã tải xong: ${task.firmware.identifier}`);
        // Trigger next in sequence
        advanceQueue();
      }),

      d.onError((_id, error, task) => {
        updateItemState(task.firmware.identifier, { status: "error", error });
        pushToast("error", `Lỗi tải ${task.firmware.identifier}: ${error}`);
        advanceQueue();
      }),
    ];

    subsRef.current = subs;

    // Kick off first item
    await processItem(0);

    async function processItem(idx: number) {
      if (abortRef.current) return;

      // Find next pending item from idx onwards
      const curItems = itemsRef.current;
      let found = -1;
      for (let i = idx; i < curItems.length; i++) {
        const st = itemStatesRef.current.get(curItems[i].firmware.identifier);
        if (!st || st.status === "pending") { found = i; break; }
      }

      if (found === -1) {
        // All done
        setRunning(false);
        subsRef.current.forEach(s => s.unsubscribe());
        subsRef.current = [];
        pushToast("success", "Hoàn thành cập nhật tất cả firmware!");
        return;
      }

      currentIndexRef.current = found;
      setCurrentIndex(found);

      const it = curItems[found];
      updateItemState(it.firmware.identifier, { status: "queued", progress: 0 });

      try {
        const savePath = await window.store.get("savePath") ?? "";
        const result = await d.add(it.firmware, savePath);
        if (!result.success) {
          updateItemState(it.firmware.identifier, { status: "error", error: result.error ?? "Không thể thêm vào hàng đợi" });
          advanceQueue();
        }
        // On success, onStarted / onCompleted / onError events will drive state
      } catch (err) {
        updateItemState(it.firmware.identifier, { status: "error", error: String(err) });
        advanceQueue();
      }
    }

    function advanceQueue() {
      const next = currentIndexRef.current + 1;
      processItem(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, items, updateItemState]);

  // ── Stop / cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      subsRef.current.forEach(s => s.unsubscribe());
    };
  }, []);

  // ── Clear completed list ───────────────────────────────────────────────────
  const handleClearDone = useCallback(() => {
    setItems(prev => {
      const kept = prev.filter(it => {
        const st = itemStates.get(it.firmware.identifier);
        return st?.status !== "completed";
      });
      return kept;
    });
    setItemStates(prev => {
      const next = new Map(prev);
      for (const [k, v] of next) {
        if (v.status === "completed") next.delete(k);
      }
      return next;
    });
  }, [itemStates]);

  const handleClearAll = useCallback(() => {
    if (running) return;
    setItems([]);
    setItemStates(new Map());
    setMergedProducts([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }, [running]);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const allDone = stats.done + stats.failed + stats.skipped === stats.total && stats.total > 0;
  const hasRemaining = stats.pending > 0;

  return (
    <div
      className="fixed inset-0 z-1000 flex flex-col bg-[#0c0c0f] text-white overflow-hidden"
      style={{ fontFamily: "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif" }}
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3! h-11 border-b border-white/7 shrink-0 bg-[#0e0e12]">
        {/* Title */}
        <div className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 32 32" className="w-4 h-4 text-[#137fec]" fill="currentColor">
            <path d="M21,24H11a2,2,0,0,0-2,2v2a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V26A2,2,0,0,0,21,24Z"/>
            <path d="M28.707,14.293l-12-12a1,1,0,0,0-1.414,0l-12,12A1,1,0,0,0,4,16H9v4a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V16h5a1,1,0,0,0,.707-1.707Z"/>
          </svg>
          <span className="text-[14px] font-bold text-gray-200">Cập nhật tất cả firmware</span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-1.5 ml-2!">
          <StatBadge label={`${stats.total} mục`} color="text-gray-400" bg="bg-white/5" />
          {stats.done > 0 && <StatBadge label={`${stats.done} xong`} color="text-emerald-400" bg="bg-emerald-400/8" />}
          {stats.failed > 0 && <StatBadge label={`${stats.failed} lỗi`} color="text-red-400" bg="bg-red-400/8" />}
          {totalBytes > 0 && <StatBadge label={formatBytes(totalBytes)} color="text-gray-500" bg="bg-white/4" />}
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {stats.done > 0 && !running && (
            <button
              onClick={handleClearDone}
              className="h-8 px-3! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-[12px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              Xóa đã xong
            </button>
          )}
          {!running && items.length > 0 && (
            <button
              onClick={handleClearAll}
              className="h-8 px-3! rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/8 hover:border-red-500/20 text-[12px] text-gray-400 hover:text-red-400 transition-colors"
            >
              Xóa tất cả
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-8 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/8 hover:border-red-500/25 text-gray-500 hover:text-red-400 flex items-center justify-center transition-all"
            title="Đóng"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Drag-sort hint */}
            {!running && (
              <div className="flex items-center gap-1.5 px-4! py-2! border-b border-white/5 bg-[#0e0e12] shrink-0">
                <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] text-gray-600">
                  Kéo thả để sắp xếp thứ tự tải xuống. Tổng dung lượng: <span className="text-gray-400">{formatBytes(totalBytes)}</span>
                </span>
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3! space-y-1.5! scrollbar-thin">
              {items.map((item, idx) => {
                const st = itemStates.get(item.firmware.identifier) ?? { status: "pending" as ItemStatus, progress: 0, speed: 0 };
                return (
                  <UpdateRow
                    key={item.firmware.identifier}
                    item={item}
                    index={idx}
                    itemState={st}
                    isDragging={dragIndex === idx}
                    isOver={overIndex === idx}
                    onDragStart={handleDragStart}
                    onDragEnter={handleDragEnter}
                    onDragEnd={handleDragEnd}
                    onRemove={handleRemove}
                    running={running}
                  />
                );
              })}
            </div>

            {/* ── Bottom bar ── */}
            <div className="shrink-0 border-t border-white/7 bg-[#0e0e12] px-4! py-3! flex items-center gap-3">
              {/* Overall progress */}
              {running && (
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1!">
                    <span>
                      {stats.done + stats.failed} / {stats.total} mục
                      {currentIndex >= 0 && ` · Đang xử lý: ${items[currentIndex]?.firmware.identifier ?? ""}`}
                    </span>
                    <span>{Math.round(((stats.done + stats.failed) / stats.total) * 100)}%</span>
                  </div>
                  <div className="w-full h-1 bg-white/8 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#137fec] transition-all duration-500"
                      style={{ width: `${((stats.done + stats.failed) / stats.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {!running && allDone && (
                <div className="flex-1 flex items-center gap-2 text-emerald-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[13px] font-medium">Đã hoàn thành tất cả!</span>
                </div>
              )}

              {!running && !allDone && <div className="flex-1" />}

              {/* Start button */}
              {!running && hasRemaining && (
                <button
                  onClick={handleStart}
                  className="flex items-center gap-2 h-9 px-5! rounded-xl bg-[#137fec] hover:bg-[#1a8fff] active:bg-[#0f6fd4] text-white text-[13px] font-semibold transition-colors shadow-[0_0_16px_rgba(19,127,236,0.25)]"
                >
                  <svg viewBox="0 0 32 32" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M28.707,14.293l-12-12a1,1,0,0,0-1.414,0l-12,12A1,1,0,0,0,4,16H9v4a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V16h5a1,1,0,0,0,.707-1.707Z"/>
                  </svg>
                  Bắt đầu cập nhật ({stats.pending} mục)
                </button>
              )}

              {running && (
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                  <Spinner className="w-3.5 h-3.5 text-[#137fec]" />
                  <span>Đang xử lý…</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ToastContainer />

      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-shimmer { animation: shimmer 1.8s linear infinite; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      `}</style>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────
function StatBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span className={`text-[11px] font-medium px-2! py-0.5! rounded-md ${bg} ${color} border border-white/6`}>
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
      <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
        <path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-center">
        <p className="text-[13px] font-medium text-gray-500">Không có firmware nào cần cập nhật</p>
        <p className="text-[11px] mt-0.5! text-gray-600">Quay lại và nhấn nút cập nhật tất cả</p>
      </div>
    </div>
  );
}
