import { app, updater } from "@/services/api";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { renderMd } from "@/ui/shared/renderMd";
import { usePageLayout } from "./layout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UpdateData {
  version: string;
  notes: string | string[] | null;
}

interface Progress {
  percent: number;
  transferred: string;
  total: string;
}

type Phase = "idle" | "downloading" | "ready" | "no-update";

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseIdle() {
  return (
    <div className="flex items-center justify-center py-20!">
      <div className="w-8 h-8 animate-spin rounded-full border-3 border-[#1e1e1e] border-t-[#0066cc]" />
    </div>
  );
}

function PhaseNoUpdate() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center py-20! text-center"
    >
      <div className="w-14! h-14! rounded-full bg-[#272729] border border-white/[0.06] flex items-center justify-center mb-4!">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-7! h-7! text-[#555]">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
      <p className="text-[14px]! text-[#aaa] font-medium">Không có bản cập nhật mới</p>
      <p className="text-[12px]! text-[#666] mt-1!">Bạn đang dùng phiên bản mới nhất.</p>
    </motion.div>
  );
}

function PhaseDownloading({ version, progress }: { version: string; progress: Progress }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-[11px]! text-[#555] uppercase tracking-[0.07em] font-medium mb-3!">Tiến độ</p>
      <div className="rounded-xl! bg-[#272729] border border-white/[0.06] p-4!">
        <div className="flex items-center justify-between mb-2!">
          <span className="text-[13px]! font-semibold text-white">{version}</span>
          <span className="text-[12px]! font-mono text-[#2997ff]">{progress.percent}%</span>
        </div>
        <div className="h-1.5! rounded-full bg-white/[0.06] overflow-hidden mb-2!">
          <motion.div
            className="h-full rounded-full bg-[#0066cc]"
            animate={{ width: `${progress.percent}%` }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <div className="flex justify-end">
          <span className="text-[10px]! font-mono text-[#555]">
            {progress.transferred} / {progress.total} MB
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function PhaseReady({ version, notes }: { version: string; notes: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="rounded-xl! bg-[#0066cc]/06 border border-[#0066cc]/20 p-4! mb-5!">
        <div className="flex items-center gap-3! mb-3!">
          <div className="w-2! h-2! rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-[13px]! font-semibold text-white">{version} đã tải xong</p>
            <p className="text-[11px]! text-[#888] mt-0.5!">Khởi động lại ứng dụng để áp dụng bản cập nhật.</p>
          </div>
        </div>
        <motion.button
          type="button"
          onClick={() => app.relaunch()}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-2.5! rounded-full! text-[13px]! font-semibold bg-[#0066cc] text-white border-none cursor-pointer transition-colors hover:bg-[#0071e3]"
        >
          Khởi động lại ngay
        </motion.button>
      </div>

      {notes && (
        <section>
          <p className="text-[11px]! text-[#555] uppercase tracking-[0.07em] font-medium mb-3!">Thay đổi</p>
          <div className="rounded-xl! bg-[#272729] border border-white/[0.06] p-5! max-h-[50vh] overflow-y-auto">
            {renderMd(notes, "md")}
          </div>
        </section>
      )}
    </motion.div>
  );
}

// ── AppUpdate ─────────────────────────────────────────────────────────────────

export default function AppUpdate() {
  usePageLayout("default");
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<UpdateData | null>(null);
  const [progress, setProgress] = useState<Progress>({ percent: 0, transferred: "0", total: "0" });

  const notes: string | null = useMemo(() => {
    if (!data?.notes) return null;
    return Array.isArray(data.notes) ? data.notes.join("\n") : data.notes;
  }, [data]);

  useEffect(() => {
    updater.getStatus().then((status) => {
      if (!status) return;
      if (status.version) setData({ version: status.version, notes: status.notes ?? null });
      if (status.progress) setProgress(status.progress);
      setPhase(status.phase);
    });

    const subs = [
      updater.onUpdateAvailable((d) => { setData(d); setPhase("downloading"); }),
      updater.onUpdateProgress((p) => setProgress(p)),
      updater.onUpdateReady(() => setPhase("ready")),
      updater.onUpdateNotAvailable(() => setPhase("no-update")),
    ];
    return () => subs.forEach((s) => s?.unsubscribe());
  }, []);

  const version = data?.version || "";

  return (
    <div className="flex flex-col size-full bg-apple-tile-3 text-white overflow-hidden">
      <div className="flex items-center px-8! py-5! border-b border-white/6 bg-apple-tile-3 shrink-0">
        <h1 className="text-[18px] font-bold text-[#e5e5e5] tracking-tight">Cập nhật ứng dụng</h1>
      </div>

      <main className="flex-1 overflow-y-auto overflow-x-hidden px-8! pt-6! pb-10!">
        <AnimatePresence mode="wait">
          {!data && phase === "idle" && <PhaseIdle key="idle" />}

          {phase === "no-update" && <PhaseNoUpdate key="no-update" />}

          {phase === "downloading" && version && (
            <motion.div key="downloading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-3! mb-5!">
                <div className="w-11! h-11! rounded-xl! bg-[#0066cc]/10 border border-[#0066cc]/20 flex items-center justify-center">
                  <span className="text-[#2997ff] text-[17px]! font-bold">v</span>
                </div>
                <div>
                  <p className="text-[13px]! text-[#888]">Có phiên bản mới</p>
                  <p className="text-[20px]! font-bold">{version}</p>
                </div>
              </div>

              <PhaseDownloading version={version} progress={progress} />

              {notes && (
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="mt-6!"
                >
                  <p className="text-[11px]! text-[#555] uppercase tracking-[0.07em] font-medium mb-3!">Thay đổi</p>
                  <div className="rounded-xl! bg-[#272729] border border-white/[0.06] p-5! max-h-[50vh] overflow-y-auto">
                    {renderMd(notes, "md")}
                  </div>
                </motion.section>
              )}
            </motion.div>
          )}

          {data && phase === "ready" && (
            <PhaseReady key="ready" version={data.version} notes={notes} />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
