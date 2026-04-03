import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "verifying"
  | "moving";

export interface Firmware {
  identifier: string;
  version: string;
  buildid: string;
  sha1sum: string;
  md5sum: string;
  sha256sum: string;
  filesize: number;
  url: string;
  releasedate: string;
  uploaddate: string;
  signed: boolean;
}

export interface Task {
  id: string;
  firmware: Firmware;
  progress: number;
  speed: number;
  status: TaskStatus;
  eta?: number;
  error?: string;
  savePath: string;
}

export interface AddResult {
  success: boolean;
  id?: string;
  error?: "DISK_FULL" | "ALREADY_IN_LIST" | "INVALID_URL" | "UNKNOWN";
}

export interface IncompleteTask {
  id: string;
  firmware: Firmware;
  savePath: string;
  tmpPath: string;
  totalSize: number;
  downloadedBytes: number;
  progress: number;
  tmpExists: boolean;
  savedAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtSize = (b: number): string => {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
};

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
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: TaskStatus;
}
function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();

  const cfg: Record<TaskStatus, { labelKey: any; cls: string }> = {
    downloading: { labelKey: "status.downloading", cls: "bg-[#137fec]/15 text-[#137fec] border-[#137fec]/30" },
    paused:      { labelKey: "status.paused",      cls: "bg-[#7a96b0]/10 text-[#7a96b0] border-[#7a96b0]/25" },
    completed:   { labelKey: "status.completed",   cls: "bg-[#1aab6d]/12 text-[#1aab6d] border-[#1aab6d]/30" },
    error:       { labelKey: "status.error",       cls: "bg-[#e04a4a]/12 text-[#e04a4a] border-[#e04a4a]/30" },
    queued:      { labelKey: "status.queued",      cls: "bg-white/5 text-[#4a6478] border-white/10" },
    verifying:   { labelKey: "status.verifying",   cls: "bg-[#8b5cf6]/12 text-[#8b5cf6] border-[#8b5cf6]/30" },
    moving:      { labelKey: "status.moving",      cls: "bg-[#e08b1a]/12 text-[#e08b1a] border-[#e08b1a]/30" },
  };

  const { labelKey, cls } = cfg[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase border ${cls}`}>
      {status === "downloading" && (
        <span className="mr-1.5! inline-block w-1.5 h-1.5 rounded-full bg-[#137fec] animate-pulse" />
      )}
      {status === "verifying" && (
        <span className="mr-1.5! inline-block w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-pulse" />
      )}
      {t(labelKey)}
    </span>
  );
}

interface ProgressBarProps {
  progress: number;
  status: TaskStatus;
}
function ProgressBar({ progress, status }: ProgressBarProps) {
  const colorMap: Record<TaskStatus, string> = {
    downloading: "bg-[#137fec]",
    paused:      "bg-[#7a96b0]",
    completed:   "bg-[#1aab6d]",
    error:       "bg-[#e04a4a]",
    queued:      "bg-[#4a6478]",
    verifying:   "bg-[#8b5cf6]",
    moving:      "bg-[#e08b1a]",
  };
  const isAnim = status === "verifying" || status === "moving";
  return (
    <div className="w-full h-0.75 bg-white/6 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${colorMap[status]} ${isAnim ? "animate-pulse" : ""}`}
        style={{ width: `${Math.min(100, progress)}%` }}
      />
    </div>
  );
}

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

function DownloadCard({ task, onPause, onResume, onCancel }: DownloadCardProps) {
  const { t } = useTranslation();
  const { id, firmware, progress, speed, status, eta, error } = task;
  const isActive = status === "downloading";
  const canPause = status === "downloading";
  const canResume = status === "paused" || status === "error";
  const canCancel = status !== "completed";

  const accentMap: Record<TaskStatus, string> = {
    downloading: "border-l-[#137fec]",
    paused:      "border-l-[#7a96b0]",
    completed:   "border-l-[#1aab6d]",
    error:       "border-l-[#e04a4a]",
    queued:      "border-l-[#4a6478]",
    verifying:   "border-l-[#8b5cf6]",
    moving:      "border-l-[#e08b1a]",
  };

  return (
    <div
      className={`
        group relative flex flex-col gap-2.5
        bg-[#16212d] hover:bg-[#1c2d3e]
        border border-[#137fec]/10 hover:border-[#137fec]/25
        border-l-2 ${accentMap[status]}
        rounded-lg px-4! py-3!
        transition-all duration-200
      `}
    >
      {/* Row 1: filename + badge + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5!">
            <span className="text-[13px] font-semibold text-[#e8f0f8] truncate leading-tight">
              {firmware.url.split("/").pop()}
            </span>
            {firmware.signed && (
              <span className="shrink-0 text-[10px] font-semibold tracking-wide px-1.5! py-0.5! rounded bg-[#1aab6d]/10 text-[#1aab6d] border border-[#1aab6d]/20">
                {t("card.signed")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] text-[#137fec]">{firmware.version}</span>
            <span className="text-[#4a6478] text-[9px]">·</span>
            <span className="font-mono text-[11px] text-[#4a6478]">{firmware.buildid}</span>
            <span className="text-[#4a6478] text-[9px]">·</span>
            <span className="text-[11px] text-[#4a6478]">{fmtSize(firmware.filesize)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={status} />
          <div className="flex items-center gap-1">
            {canPause && (
              <button
                onClick={() => onPause(id)}
                className="w-7 h-7 flex items-center justify-center rounded bg-white/4 border border-[#137fec]/15 text-[#7a96b0] hover:bg-[#137fec]/15 hover:border-[#137fec]/40 hover:text-[#137fec] transition-all duration-150"
                title={t("action.pause")}
              >
                <IconPause />
              </button>
            )}
            {canResume && (
              <button
                onClick={() => onResume(id)}
                className="w-7 h-7 flex items-center justify-center rounded bg-white/4 border border-[#137fec]/15 text-[#7a96b0] hover:bg-[#137fec]/15 hover:border-[#137fec]/40 hover:text-[#137fec] transition-all duration-150"
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
          <span className={`font-mono text-[11px] font-semibold ${isActive ? "text-[#137fec]" : "text-[#4a6478]"}`}>
            {progress.toFixed(1)}%
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
}

// ─── Sidebar Stats ─────────────────────────────────────────────────────────────

interface SidebarProps {
  tasks: Task[];
}
function Sidebar({ tasks }: SidebarProps) {
  const { t } = useTranslation();

  const active    = tasks.filter((t) => t.status === "downloading").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const paused    = tasks.filter((t) => t.status === "paused").length;
  const queued    = tasks.filter((t) => t.status === "queued").length;
  const errored   = tasks.filter((t) => t.status === "error").length;

  const statItems = [
    { labelKey: "sidebar.stat.active",    value: active,    color: "text-[#137fec]" },
    { labelKey: "sidebar.stat.completed", value: completed, color: "text-[#1aab6d]" },
    { labelKey: "sidebar.stat.paused",    value: paused,    color: "text-[#7a96b0]" },
    { labelKey: "sidebar.stat.queued",    value: queued,    color: "text-[#4a6478]" },
    { labelKey: "sidebar.stat.errors",    value: errored,   color: "text-[#e04a4a]" },
  ];

  return (
    <aside className="w-55 shrink-0 flex flex-col gap-4">
      <div className="pb-4! border-b border-[#137fec]/15">
        <div className="text-[15px] font-semibold tracking-tight text-[#e8f0f8]">
          IPSW{" "}
          <span className="text-[#137fec]">Downloads</span>
        </div>
        <div className="text-[11px] text-[#4a6478] mt-0.5! font-mono">
          {tasks.length} total task{tasks.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {statItems.map(({ labelKey, value, color }) => (
          <div
            key={labelKey}
            className="flex items-center justify-between px-3! py-2! rounded-md bg-[#16212d] border border-[#137fec]/8"
          >
            <span className="text-[11px] text-[#4a6478] uppercase tracking-wider">
              {t(labelKey as any)}
            </span>
            <span className={`font-mono text-[14px] font-semibold ${color}`}>{value}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

interface DownloadPageProps {
  onClose?: () => void;
}

export default function DownloadPage({ onClose }: DownloadPageProps = {}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const upsertTask = useCallback((task: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx === -1) return [...prev, task];
      const next = [...prev];
      next[idx] = task;
      return next;
    });
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Subscribe events ────────────────────────────────────────────────────────

  useEffect(() => {
    window.downloader.getAllTask().then(setTasks).catch(console.error);

    const subs = [
      window.downloader.onAdded((_id, task) => upsertTask(task)),
      window.downloader.onProgress((_id, task) => upsertTask(task)),
      window.downloader.onCompleted((_id, task) => upsertTask(task)),
      window.downloader.onPaused((_id, task) => upsertTask(task)),
      window.downloader.onResumed((_id, task) => {
        if (task) upsertTask(task);
        else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === _id ? { ...t, status: "downloading" as TaskStatus } : t
            )
          );
        }
      }),
      window.downloader.onCancelled((id) => removeTask(id)),
      window.downloader.onIncompleteDeleted((id) => removeTask(id)),
      window.downloader.onError((_id, _error, task) => upsertTask(task)),
    ];

    return () => {
      subs.forEach((s) => s.unsubscribe());
    };
  }, [upsertTask, removeTask]);

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handlePause = useCallback(async (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "paused" as TaskStatus } : t))
    );
    await window.downloader.pause(id);
  }, []);

  const handleResume = useCallback(async (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "downloading" as TaskStatus } : t))
    );
    await window.downloader.resume(id);
  }, []);

  const handleCancel = useCallback(async (id: string) => {
    removeTask(id);
    await window.downloader.cancel(id);
  }, [removeTask]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const sorted = [...tasks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  const filtered =
    filter === "all" ? sorted : sorted.filter((t) => t.status === filter);

  const filterTabs: Array<{ key: TaskStatus | "all"; labelKey: string }> = [
    { key: "all",         labelKey: "filter.all" },
    { key: "downloading", labelKey: "filter.active" },
    { key: "paused",      labelKey: "filter.paused" },
    { key: "queued",      labelKey: "filter.queued" },
    { key: "completed",   labelKey: "filter.done" },
    { key: "error",       labelKey: "filter.errors" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: "#101922", fontFamily: "'Syne', 'JetBrains Mono', sans-serif" }}
    >
      {/* Sidebar */}
      <div className="h-full px-5! py-5! border-r border-[#137fec]/10 flex flex-col">
        <Sidebar tasks={tasks} />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-5! py-3! border-b border-[#137fec]/10">
          {filterTabs.map(({ key, labelKey }) => {
            const count =
              key === "all"
                ? tasks.length
                : tasks.filter((t) => t.status === key).length;
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`
                  flex items-center gap-1.5 px-3! py-1.5! rounded text-[11px] font-semibold uppercase tracking-widest
                  border transition-all duration-150
                  ${
                    active
                      ? "bg-[#137fec]/15 border-[#137fec]/40 text-[#137fec]"
                      : "bg-transparent border-transparent text-[#4a6478] hover:text-[#7a96b0] hover:border-white/10"
                  }
                `}
              >
                {t(labelKey as any)}
                {count > 0 && (
                  <span
                    className={`font-mono text-[10px] px-1! py-0.5! rounded leading-none ${
                      active
                        ? "bg-[#137fec]/20 text-[#137fec]"
                        : "bg-white/6 text-[#4a6478]"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {onClose && (
            <button
              onClick={onClose}
              className="ml-auto! w-7 h-7 flex items-center justify-center rounded border border-white/10 text-[#4a6478] hover:bg-[#e04a4a]/15 hover:border-[#e04a4a]/40 hover:text-[#e04a4a] transition-all duration-150"
              title={t("action.close")}
            >
              <IconClose />
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5! py-4!">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#4a6478]">
              <div className="text-4xl opacity-20">↓</div>
              <div className="text-[13px]">{t("empty.message")}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((task) => (
                <DownloadCard
                  key={task.id}
                  task={task}
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}