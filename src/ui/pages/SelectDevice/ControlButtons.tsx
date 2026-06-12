import { memo } from "react";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { formatBytes, formatEta, Spinner } from "@/ui/shared";
import type { CardTask, ControlAction, DeviceEntry } from "./types";
import { STATUS_CONFIG, STATUS_LABEL, STATUS_COLOR } from "./constants";
import { ProgressBar } from "./ProgressBar";
import type { TaskStatus } from "@global-type"

export const ControlButtons = memo(function ControlButtons({
  entry,
  status,
  pendingAction,
  incompTask,
  corruptedFile,
  onAction,
  readonly,
}: {
  entry: DeviceEntry;
  status: CardTask;
  pendingAction: ControlAction | null;
  incompTask?: IncompleteTaskClient;
  corruptedFile?: IPSWFile;
  onAction: (action: ControlAction, fw?: Firmware) => void;
  readonly?: boolean;
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
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3! py-2.5! space-y-1!">
          <p className="text-[11px] text-amber-300 font-semibold">Tệp không hoàn chỉnh</p>
          <p className="text-[10px] text-amber-400/70">
            Kích thước: {formatBytes(actualSize)} / {formatBytes(expectedSize)}
          </p>
          <p className="text-[10px] text-amber-400/60">
            Tệp tải về bị thiếu dữ liệu so với bản gốc.
          </p>
        </div>

        {incompTask ? (
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
        <div className="bg-sky-500/8 border border-sky-500/20 rounded-xl px-3! py-2.5! space-y-1.5!">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-sky-300 font-semibold">Tải chưa xong</p>
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
              ⚠ Không tìm thấy file tạm thời, sẽ tải lại từ đầu.
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
            ? <><Spinner className="w-3.5 h-3.5 text-cyan-300" /> Đang chuẩn bị...</>
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
  if (["downloading", "paused"].includes(status)) {
    if (readonly) {
      return (
        <div className="bg-white/4 rounded-xl p-3! border border-white/6">
          <div className="flex items-center gap-2">
            <div className={`w-1.75 h-1.75 rounded-full ${STATUS_CONFIG[status].dot} ${STATUS_CONFIG[status].animate ? "animate-pulse" : ""}`} />
            <span className={`text-[13px] font-semibold ${STATUS_CONFIG[status].text}`}>{STATUS_LABEL[status]}</span>
            <span className="text-[10px] text-gray-500">qua thiết bị liên kết</span>
          </div>
        </div>
      );
    }

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

  if (status === "queued") {
    return (
      <div className="flex">
        <button
            disabled={busy}
            onClick={() => onAction("cancel")}
            className="flex-1 px-4! py-2.5! rounded-xl bg-red-500/12 hover:bg-red-500/22 border border-red-500/20 text-red-400 text-[12px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {pendingAction === "cancel" ? <><Spinner className="w-3 h-3 text-red-400" /> Đang huỷ…</> : "Huỷ"}
          </button>
      </div>
    )
  }

  // ── Đang xác minh / di chuyển ─────────────────────────────────────────────
  if (status === "verifying" || status === "moving") {
    if (readonly) {
      return (
        <div className="bg-white/4 rounded-xl p-3! border border-white/6">
          <div className="flex items-center gap-2">
            <div className={`w-1.75 h-1.75 rounded-full ${STATUS_CONFIG[status].dot} animate-pulse`} />
            <span className={`text-[13px] font-semibold ${STATUS_CONFIG[status].text}`}>{STATUS_LABEL[status]}…</span>
            <span className="text-[10px] text-gray-500">qua thiết bị liên kết</span>
          </div>
        </div>
      );
    }

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
