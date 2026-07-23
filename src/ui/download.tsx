import { memo, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatBytes } from "./shared";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDownloadStore } from "../stores/download-store";

import type { Task, TaskStatus } from "@custom-type/downloader";
import type { DownloadFilter } from "../stores/download-store";
import { getFileNameFromUrl } from "../core/helper";
import utils from "../core/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtSpeed = (bps: number): string => {
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " MB/s";
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " KB/s";
  return "0 B/s";
};

const fmtEta = (s?: number): string => {
  if (!s || s <= 0) return "--";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const STATUS_ORDER: Record<TaskStatus, number> = {
  downloading: 0,
  verifying: 1,
  moving: 2,
  paused: 3,
  queued: 4,
  error: 5,
  completed: 6,
  cancelled: 7,
};

// ─── Filter nav items ─────────────────────────────────────────────────────────

interface FilterNavItem {
  key: DownloadFilter;
  labelKey: string;
  icon: React.ReactNode;
}

const IconAll = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconActive = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconPaused = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const IconQueued = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconDone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const IconError = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px]! h-[18px]!">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const FILTER_NAV_ITEMS: FilterNavItem[] = [
  { key: "all", labelKey: "filter.all", icon: <IconAll /> },
  { key: "downloading", labelKey: "filter.active", icon: <IconActive /> },
  { key: "paused", labelKey: "filter.paused", icon: <IconPaused /> },
  { key: "queued", labelKey: "filter.queued", icon: <IconQueued /> },
  { key: "completed", labelKey: "filter.done", icon: <IconDone /> },
  { key: "error", labelKey: "filter.errors", icon: <IconError /> },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge = memo(function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();

  const cfg: Record<TaskStatus, { labelKey: string; cls: string }> = {
    downloading: { labelKey: "status.downloading", cls: "bg-[#0066cc]/15 text-[#0066cc] border-[#0066cc]/30" },
    paused: { labelKey: "status.paused", cls: "bg-[#7a96b0]/10 text-[#7a96b0] border-[#7a96b0]/25" },
    completed: { labelKey: "status.completed", cls: "bg-[#1aab6d]/12 text-[#1aab6d] border-[#1aab6d]/30" },
    error: { labelKey: "status.error", cls: "bg-[#e04a4a]/12 text-[#e04a4a] border-[#e04a4a]/30" },
    queued: { labelKey: "status.queued", cls: "bg-white/5 text-[#4a6478] border-white/10" },
    verifying: { labelKey: "status.verifying", cls: "bg-[#af52de]/12 text-[#af52de] border-[#af52de]/30" },
    moving: { labelKey: "status.moving", cls: "bg-[#e08b1a]/12 text-[#e08b1a] border-[#e08b1a]/30" },
    cancelled: { labelKey: "status.cancelled", cls: "bg-white/5 text-[#4a6478] border-white/10" },
  };

  const { labelKey, cls } = cfg[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase border ${cls}`}>
      {status === "downloading" && (
        <span className="mr-1.5! inline-block w-1.5 h-1.5 rounded-full bg-apple-primary animate-pulse" />
      )}
      {status === "verifying" && (
        <span className="mr-1.5! inline-block w-1.5 h-1.5 rounded-full bg-[#af52de] animate-pulse" />
      )}
      {t(labelKey as any)}
    </span>
  );
});

const ProgressBar = memo(function ProgressBar({ progress, status }: { progress: number; status: TaskStatus }) {
  const colorMap: Record<TaskStatus, string> = {
    downloading: "bg-[#0066cc]",
    paused: "bg-[#7a96b0]",
    completed: "bg-[#1aab6d]",
    error: "bg-[#e04a4a]",
    queued: "bg-[#4a6478]",
    verifying: "bg-[#af52de]",
    moving: "bg-[#e08b1a]",
    cancelled: "bg-[#4a6478]",
  };
  const isAnim = status === "verifying" || status === "moving";
  return (
    <div className="w-full h-0.75 bg-white/6 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${colorMap[status]} ${isAnim ? "animate-pulse" : ""}`}
        style={{ width: `${Math.min(100, progress)}%`, transition: "width 150ms linear" }}
      />
    </div>
  );
});

// Icon components
const IconPause = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="5" y1="3" x2="5" y2="13" />
    <line x1="11" y1="3" x2="11" y2="13" />
  </svg>
);
const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 3l10 5-10 5z" />
  </svg>
);
const IconClose = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="4" x2="12" y2="12" />
    <line x1="12" y1="4" x2="4" y2="12" />
  </svg>
);
const IconRetry = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 8a6 6 0 1 1 1.5 4" />
    <polyline points="2,13 2,8 7,8" />
  </svg>
);

// ─── Download Card ─────────────────────────────────────────────────────────────

interface DownloadCardProps {
  task: Task;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

const DownloadCard = memo(function DownloadCard({ task, onPause, onResume, onCancel }: DownloadCardProps) {
  const { t } = useTranslation();
  const { id, firmware, progress, speed, status, eta, error } = task;
  const isActive = status === "downloading";
  const canPause = status === "downloading";
  const canResume = status === "paused" || status === "error";
  const canCancel = status !== "completed";
  const filename = useMemo(() => getFileNameFromUrl(firmware.url), [firmware.url]);

  const accentMap: Record<TaskStatus, string> = {
    downloading: "border-l-[#0066cc]",
    paused: "border-l-[#7a96b0]",
    completed: "border-l-[#1aab6d]",
    error: "border-l-[#e04a4a]",
    queued: "border-l-[#4a6478]",
    verifying: "border-l-[#af52de]",
    moving: "border-l-[#e08b1a]",
    cancelled: "border-l-[#4a6478]",
  };

  return (
    <div
      className={`
        group relative flex flex-col gap-2.5
        bg-apple-tile-1 hover:bg-apple-tile-2
        border border-white/6 hover:border-white/10
        border-l-2 ${accentMap[status]}
        rounded-xl px-4! py-3!
        transition-all duration-200
      `}
    >
      {/* Row 1: filename + badge + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5!">
            <span className="text-[13px] font-semibold text-[#e8f0f8] truncate leading-tight">
              {filename}
            </span>
            {firmware.signed && (
              <span className="shrink-0 text-[10px] font-semibold tracking-wide px-1.5! py-0.5! rounded bg-[#1aab6d]/10 text-[#1aab6d] border border-[#1aab6d]/20">
                {t("card.signed")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] text-apple-primary">{firmware.version}</span>
            <span className="text-[#4a6478] text-[9px]">·</span>
            <span className="font-mono text-[11px] text-[#4a6478]">{firmware.buildid}</span>
            <span className="text-[#4a6478] text-[9px]">·</span>
            <span className="text-[11px] text-[#4a6478]">{formatBytes(firmware.filesize)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={status} />
          <div className="flex items-center gap-1">
            {canPause && (
              <button
                onClick={() => onPause(id)}
                className="w-7 h-7 flex items-center justify-center rounded bg-white/4 border border-apple-primary/18 text-[#8ba6ba] hover:bg-apple-primary/18 hover:border-apple-primary/45 hover:text-apple-primary transition-all duration-150"
                title={t("action.pause")}
              >
                <IconPause />
              </button>
            )}
            {canResume && (
              <button
                onClick={() => onResume(id)}
                className="w-7 h-7 flex items-center justify-center rounded bg-white/4 border border-apple-primary/18 text-[#8ba6ba] hover:bg-apple-primary/18 hover:border-apple-primary/45 hover:text-apple-primary transition-all duration-150"
                title={status === "error" ? t("action.retry") : t("action.resume")}
              >
                {status === "error" ? <IconRetry /> : <IconPlay />}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => onCancel(id)}
                className="w-7 h-7 flex items-center justify-center rounded bg-white/4 border border-white/10 text-[#4a6478] hover:bg-[#e04a4a]/15 hover:border-[#e04a4a]/40 hover:text-[#e04a4a] transition-all duration-150"
                title={t("action.cancel")}
              >
                <IconClose />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: progress */}
      <div>
        <ProgressBar progress={progress} status={status} />
        <div className="flex items-center justify-between mt-1.5!">
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[11px] ${isActive ? "text-[#e8f0f8]" : "text-[#4a6478]"}`}>
              ↓ {isActive ? fmtSpeed(speed) : "—"}
            </span>
            <span className={`font-mono text-[11px] ${isActive ? "text-[#7a96b0]" : "text-[#4a6478]"}`}>
              {t("card.eta")} {isActive ? fmtEta(eta) : "—"}
            </span>
          </div>
          <span className={`font-mono text-[11px] font-semibold ${isActive ? "text-apple-primary" : "text-[#4a6478]"}`}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Error row */}
      {error && (
        <div className="font-mono text-[11px] text-[#e04a4a] bg-[#e04a4a]/8 border border-[#e04a4a]/20 rounded px-2.5! py-1.5!">
          ✕ {error}
        </div>
      )}
    </div>
  );
});

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function DownloadPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const taskIds = useDownloadStore((state) => state.taskIds);
  const tasksById = useDownloadStore((state) => state.tasksById);
  const filter = useDownloadStore((state) => state.filter);
  const setTasks = useDownloadStore((state) => state.setTasks);
  const upsertTask = useDownloadStore((state) => state.upsertTask);
  const removeTask = useDownloadStore((state) => state.removeTask);
  const patchTask = useDownloadStore((state) => state.patchTask);
  const setFilter = useDownloadStore((state) => state.setFilter);
  const hydrated = useDownloadStore((state) => state.hydrated);
  const markHydrated = useDownloadStore((state) => state.markHydrated);

  // ── Subscribe events ────────────────────────────────────────────────────────

  useEffect(() => {
    if (hydrated) return;
    window.downloader.getAllTask().then(setTasks).catch(console.error);
    markHydrated();
  }, [hydrated, markHydrated, setTasks]);

  useEffect(() => {
    const subs = [
      window.downloader.onAdded((_id, task) => upsertTask(task)),
      window.downloader.onProgress((_id, task) => upsertTask(task)),
      window.downloader.onCompleted((_id, task) => upsertTask(task)),
      window.downloader.onPaused((_id, task) => upsertTask(task)),
      window.downloader.onResumed((_id, task) => {
        if (task) upsertTask(task);
        else patchTask(_id, { status: "downloading" as TaskStatus });
      }),
      window.downloader.onCancelled((id) => removeTask(id)),
      window.downloader.onIncompleteDeleted((id) => removeTask(id)),
      window.downloader.onError((_id, _error, task) => upsertTask(task)),
    ];

    return () => {
      subs.forEach((s) => s.unsubscribe());
    };
  }, [upsertTask, removeTask, patchTask]);

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handlePause = useCallback(async (id: string) => {
    patchTask(id, { status: "paused" as TaskStatus });
    const result = await window.downloader.pause(id);
    if (!result.success) {
      if (result.error === "NOT_FOUND") {
        utils.showErrorMessage(t("message.downloader.lifecycle.pause.not_found"));
      } else {
        utils.showErrorMessage(t("message.downloader.lifecycle.pause.invalid_status"));
      }
    } else {
      utils.showSuccessMessage(t("message.downloader.lifecycle.pause.success"));
    }
  }, [patchTask, t]);

  const handleResume = useCallback(async (id: string) => {
    patchTask(id, { status: "downloading" as TaskStatus });
    const result = await window.downloader.resume(id);
    if (!result.success) {
      if (result.error === "NOT_FOUND") {
        utils.showErrorMessage(t("message.downloader.lifecycle.resume.not_found"));
      } else {
        utils.showErrorMessage(t("message.downloader.lifecycle.resume.invalid_status"));
      }
    } else {
      utils.showSuccessMessage(t("message.downloader.lifecycle.resume.success"));
    }
  }, [patchTask, t]);

  const handleCancel = useCallback(async (id: string) => {
    try { await utils.customConfirm("Huỷ tác vụ này? Tiến độ tải sẽ bị mất."); } catch { return; }
    removeTask(id);
    const result = await window.downloader.cancel(id);
    if (!result.success) {
      if (result.error === "NOT_FOUND") {
        utils.showErrorMessage(t("message.downloader.lifecycle.cancel.not_found"));
      } else {
        utils.showErrorMessage(t("message.downloader.lifecycle.cancel.invalid_status"));
      }
    } else {
      utils.showSuccessMessage(t("message.downloader.lifecycle.cancel.success"));
    }
  }, [removeTask, t]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const tasks = useMemo(() => taskIds.map((id) => tasksById[id]).filter((task): task is Task => Boolean(task)), [taskIds, tasksById]);
  const sorted = useMemo(() => [...tasks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]), [tasks]);
  const filtered = useMemo(
    () => (filter === "all" ? sorted : sorted.filter((task) => task.status === filter)),
    [filter, sorted]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus | "all", number> = {
      all: tasks.length,
      downloading: 0,
      verifying: 0,
      moving: 0,
      paused: 0,
      queued: 0,
      error: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const task of tasks) counts[task.status] += 1;
    return counts;
  }, [tasks]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed bottom-0 right-0 flex bg-apple-tile-3 text-white overflow-hidden" style={{ top: "var(--titlebar-height)", left: "var(--sidebar-w, 0px)" }}>
      {/* Sidebar — same style as Settings */}
      <nav className="w-52 shrink-0 self-stretch sticky top-0 bg-[#1e1e20] border-r border-white/6 flex flex-col pt-6! pb-4!">
        <div className="px-4! mb-6!">
          <h2 className="text-[13px] font-semibold text-[#5a6a7a] uppercase tracking-[0.08em]">
            {t("setting.sidebar.download")}
          </h2>
        </div>
        <div className="flex-1 flex flex-col gap-0.5 px-2!">
          {FILTER_NAV_ITEMS.map(({ key, labelKey, icon }) => {
            const isActive = filter === key;
            const count = statusCounts[key as TaskStatus | "all"];
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={[
                  "flex items-center gap-3! w-full px-3! py-2.5! rounded-lg text-[13px] font-medium border-none cursor-pointer transition-all duration-150 text-left",
                  isActive
                    ? "bg-apple-primary/15 text-apple-primary-on-dark"
                    : "bg-transparent text-apple-ink-muted-48 hover:bg-white/4 hover:text-[#c8c8c8]",
                ].join(" ")}
              >
                <span className={isActive ? "text-apple-primary-on-dark" : "text-[#5a6a7a]"}>
                  {icon}
                </span>
                <span className="flex-1">{t(labelKey as any)}</span>
                {count > 0 && (
                  <span className={`font-mono text-[11px] px-1.5! py-0.5! rounded leading-none ${isActive
                      ? "bg-apple-primary/22 text-apple-primary-on-dark"
                      : "bg-white/6 text-[#5d7284]"
                    }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — same as Settings */}
        <div className="flex items-center justify-between px-8! py-5! border-b border-white/6 bg-apple-tile-3 shrink-0">
          <h1 className="text-[18px] font-bold text-[#e5e5e5] tracking-tight">
            {t("setting.sidebar.download" as any)}
          </h1>
          <button
            onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/", { replace: true })}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/6 bg-white/4 text-apple-ink-muted-48 transition-all duration-150 hover:bg-white/8 hover:border-white/10 hover:text-white cursor-pointer shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* List */}
        <main className="flex-1 overflow-y-auto px-8! pt-6! pb-10!">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-apple-ink-muted-48">
              <div className="text-4xl opacity-20">↓</div>
              <div className="text-[13px]">{t("empty.message")}</div>
            </div>
          ) : (
            <motion.div
              className="flex flex-col gap-2"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } } }}
            >
              <AnimatePresence mode="popLayout">
                {filtered.map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    variants={{
                      hidden: { opacity: 0, y: 8, scale: 0.985 },
                      show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0, 0, 0.2, 1] } },
                    }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
                  >
                    <DownloadCard
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onCancel={handleCancel}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}
