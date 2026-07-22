import { memo, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatBytes } from "./shared";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDownloadStore } from "../stores/download-store";

import type { Task, TaskStatus } from "@custom-type/downloader";
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

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: TaskStatus;
}
const StatusBadge = memo(function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();

  const cfg: Record<TaskStatus, { labelKey: any; cls: string }> = {
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
      {t(labelKey)}
    </span>
  );
});

interface ProgressBarProps {
  progress: number;
  status: TaskStatus;
}
const ProgressBar = memo(function ProgressBar({ progress, status }: ProgressBarProps) {
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

// ─── Sidebar Stats ─────────────────────────────────────────────────────────────

interface SidebarProps {
  active: number;
  completed: number;
  paused: number;
  queued: number;
  errored: number;
  total: number;
}
const Sidebar = memo(function Sidebar({ active, completed, paused, queued, errored, total }: SidebarProps) {
  const { t } = useTranslation();

  const statItems: Array<{ labelKey: string; value: number; color: string }> = [
    { labelKey: "sidebar.stat.active", value: active, color: "text-[#0066cc]" },
    { labelKey: "sidebar.stat.completed", value: completed, color: "text-[#1aab6d]" },
    { labelKey: "sidebar.stat.paused", value: paused, color: "text-[#7a96b0]" },
    { labelKey: "sidebar.stat.queued", value: queued, color: "text-[#4a6478]" },
    { labelKey: "sidebar.stat.errors", value: errored, color: "text-[#e04a4a]" },
  ];

  return (
    <aside className="w-55 shrink-0 flex flex-col gap-4">
      <div className="pb-4! border-b border-white/6">
        <div className="text-[15px] font-semibold tracking-tight text-white">
          IPSW{" "}
          <span className="text-apple-primary">Downloads</span>
        </div>
        <div className="text-[11px] text-[#6b7f92] mt-0.5! font-mono">
          {total} total task{total !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {statItems.map(({ labelKey, value, color }) => (
          <div
            key={labelKey}
            className="flex items-center justify-between px-3! py-2! rounded-md bg-apple-tile-1 border border-white/6"
          >
            <span className="text-[11px] text-[#6b7f92] uppercase tracking-wider">
              {t(labelKey as any)}
            </span>
            <span className={`font-mono text-[14px] font-semibold ${color}`}>{value}</span>
          </div>
        ))}
      </div>
    </aside>
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

  const stats = useMemo(() => {
    let active = 0;
    let completed = 0;
    let paused = 0;
    let queued = 0;
    let errored = 0;

    for (const task of tasks) {
      switch (task.status) {
        case "downloading": active++; break;
        case "completed": completed++; break;
        case "paused": paused++; break;
        case "queued": queued++; break;
        case "error": errored++; break;
      }
    }

    return { active, completed, paused, queued, errored, total: tasks.length };
  }, [tasks]);

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

  const filterTabs: Array<{ key: TaskStatus | "all"; labelKey: string }> = [
    { key: "all", labelKey: "filter.all" },
    { key: "downloading", labelKey: "filter.active" },
    { key: "paused", labelKey: "filter.paused" },
    { key: "queued", labelKey: "filter.queued" },
    { key: "completed", labelKey: "filter.done" },
    { key: "error", labelKey: "filter.errors" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed flex size-full overflow-hidden"
      style={{ background: "#252527" }}
    >
      {/* Sidebar */}
      <div className="h-full px-5! py-5! border-r border-white/6 flex flex-col">
        <Sidebar {...stats} />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-5! py-3! border-b border-white/6 bg-apple-tile-3">
          {filterTabs.map(({ key, labelKey }) => {
            const count = statusCounts[key];
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`
                  flex items-center gap-1.5 px-3! py-1.5! rounded text-[11px] font-semibold uppercase tracking-widest
                  border transition-all duration-150
                  ${active
                    ? "bg-apple-primary/18 border-apple-primary/45 text-apple-primary-on-dark"
                    : "bg-transparent border-transparent text-apple-ink-muted-48 hover:text-white hover:border-white/10"
                  }
                `}
              >
                {t(labelKey as any)}
                {count > 0 && (
                  <span
                    className={`font-mono text-[10px] px-1! py-0.5! rounded leading-none ${active
                        ? "bg-apple-primary/22 text-apple-primary"
                        : "bg-white/6 text-[#5d7284]"
                      }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/")}
            className="ml-auto! w-7 h-7 flex items-center justify-center rounded border border-white/10 text-[#4a6478] hover:bg-[#e04a4a]/15 hover:border-[#e04a4a]/40 hover:text-[#e04a4a] transition-all duration-150"
            title={t("action.close")}
          >
            <IconClose />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5! py-4!">
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
        </div>
      </div>
    </div>
  );
}