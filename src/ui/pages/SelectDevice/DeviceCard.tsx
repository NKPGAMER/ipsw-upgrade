import { useState, useRef, useEffect, memo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { formatBytes, formatEta, Spinner } from "@/ui/shared";
import type { DeviceEntry } from "./types";
import { OS_LABEL, STATUS_CONFIG } from "./constants";
import { computeCardStatus, resolveProduct } from "./utils";
import { ModeBadge } from "./ModeBadge";
import { CardBorderProgress } from "./CardBorderProgress";
import { DeviceName } from "./DeviceName";
import { CardSkeleton } from "./CardSkeleton";
import { PRODUCT_ICON } from "./icons";

// ── Shared IntersectionObserver (firmware lazy-load only) ──
let _sharedIO: IntersectionObserver | null = null;
const _ioCallbacks = new Map<Element, (visible: boolean) => void>();

function getSharedIO(): IntersectionObserver {
  if (!_sharedIO) {
    _sharedIO = new IntersectionObserver((entries) => {
      for (const e of entries) _ioCallbacks.get(e.target)?.(e.isIntersecting);
    }, { threshold: 0.1 });
  }
  return _sharedIO;
}

export const DeviceCard = memo(function DeviceCard({
  entry,
  selected,
  allFiles,
  incompleteTasks,
  pending,
  onClick,
  onVisible,
  linkedGroup,
}: {
  entry: DeviceEntry;
  selected: boolean;
  allFiles: IPSWFile[];
  incompleteTasks: IncompleteTaskClient[];
  pending: boolean;
  onClick: () => void;
  onVisible: (identifier: string) => void;
  linkedGroup?: Set<string>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [flash, setFlash] = useState(false);
  const [turboFlash, setTurboFlash] = useState(false);
  const prevMode = useRef(entry.task?.mode);
  const { t } = useTranslation();

  const status = computeCardStatus(entry, allFiles, incompleteTasks, linkedGroup);
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
    const currentMode = entry.task?.mode;
    if (prevMode.current === "normal" && currentMode === "turbo") {
      setTurboFlash(true);
      setTimeout(() => setTurboFlash(false), 2000);
    }
    prevMode.current = currentMode;
  }, [entry.task?.mode, entry.device.name]);

  // IntersectionObserver for firmware lazy-load
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = getSharedIO();
    _ioCallbacks.set(el, setVisible);
    io.observe(el);
    return () => {
      _ioCallbacks.delete(el);
      io.unobserve(el);
    };
  }, []);

  const signalledRef = useRef(false);
  useEffect(() => {
    if (!visible || signalledRef.current || entry.firmwares != null) return;
    signalledRef.current = true;
    onVisible(entry.device.identifier);
  }, [visible, entry.firmwares, entry.device.identifier, onVisible]);

  const latestFw = entry.firmwares?.[0] ?? null;
  const inProgress = !!entry.task &&
    ["downloading", "paused", "queued", "verifying", "moving"].includes(entry.task.status);
  const isOwner = !entry.task || entry.task.firmware.identifier === entry.device.identifier;

  const incompTask = latestFw
    ? (() => {
        const direct = incompleteTasks.find(
          t => t.firmware.identifier === entry.device.identifier && t.firmware.buildid === latestFw.buildid
        );
        if (direct) return direct;
        if (linkedGroup) {
          for (const linkedId of Array.from(linkedGroup)) {
            if (linkedId === entry.device.identifier) continue;
            const match = incompleteTasks.find(
              t => t.firmware.identifier === linkedId && t.firmware.buildid === latestFw.buildid
            );
            if (match) return match;
          }
        }
        return undefined;
      })()
    : undefined;

  const product = resolveProduct(entry.device.identifier);

  const osLabel = OS_LABEL[product as Product] ?? "Version";
  const firmwaresLoaded = entry.firmwares != null;
  const isWaiting = entry.firmwares === undefined;
  const showAurora = !firmwaresLoaded;
  const borderProgress = (() => {
    if (isOwner && inProgress) {
      return {
        value: entry.task!.progress,
        colorClass: STATUS_CONFIG[status].textClass,
        animated: ["downloading", "verifying", "moving"].includes(entry.task!.status),
      };
    }
    if (status === "incomplete_dl" && incompTask) {
      return {
        value: incompTask.progress,
        colorClass: STATUS_CONFIG.incomplete_dl.textClass,
        animated: false,
      };
    }
    return null;
  })();

  return (
    <motion.div
      ref={cardRef}
      onClick={onClick}
      variants={{
        hidden: { opacity: 0, y: 10, scale: 0.985 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: 0.28, ease: [0, 0, 0.2, 1] },
        },
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.08 }}
      className={`
        group h-50 relative cursor-pointer rounded-[14px] border select-none
        ${selected && !borderProgress
          ? "overflow-hidden border-[#0066cc]/50 bg-[#0066cc]/8"
          : borderProgress
            ? "overflow-visible border-transparent bg-[#272729] hover:bg-[#2a2a2c]"
            : showAurora
              ? "overflow-hidden border-white/[0.06] bg-[#272729]"
              : "overflow-hidden border-white/[0.06] bg-[#272729] hover:bg-[#2a2a2c] hover:border-white/[0.1]"
        }
        ${selected && borderProgress ? "ring-1 ring-white/8" : ""}
        ${flash ? "animate-card-flash" : ""}
      `}
      style={{
        transition: "background 120ms var(--ease-smooth), border-color 120ms var(--ease-smooth)",
      }}
    >
      {pending && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-[14px]">
          <Spinner className="w-5 h-5 text-white/60" />
        </div>
      )}

      {borderProgress && (
        <CardBorderProgress
          value={borderProgress.value}
          colorClass={borderProgress.colorClass}
        />
      )}

      {selected && !borderProgress && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-[#2997ff]" />
      )}

      {!firmwaresLoaded ? (
        <>
          <CardSkeleton />
          {isWaiting && (
            <div className="absolute bottom-3 right-3">
              <span className="text-[10px] text-gray-600 animate-pulse">đang chờ…</span>
            </div>
          )}
        </>
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
              <div className="inline-flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5! py-1! font-mono text-[13px]">
                <p className="text-white font-medium tracking-wide">{osLabel}</p>
                <span className="text-[#0066cc] font-bold">{latestFw.version}</span>
              </div>
            </div>
          )}

          {/* ── Progress states: integrated stats ── */}
          {isOwner && inProgress ? (
            <div className="mt-1! pt-3! border-t border-white/5">
              <div className="flex items-center gap-2 mb-1.5!">
                <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5! py-1! ${cfg.pillClass}`}>
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass} shrink-0 ${cfg.animated ? "animate-pulse" : ""}`}
                  />
                  <span className={`text-[11px] font-semibold ${cfg.textClass}`}>{t(cfg.labelId as any)}</span>
                </div>
                {entry.task?.mode && <ModeBadge mode={entry.task.mode} flash={turboFlash} />}
              </div>
              <div className="flex items-end justify-between">
                <div className="flex items-baseline gap-1">
                  <span className={`text-[24px] font-bold font-mono tabular-nums leading-none ${cfg.textClass}`}>
                    {Math.floor(entry.task!.progress)}
                  </span>
                  <span className={`text-[12px] font-medium ${cfg.textClass} opacity-60`}>%</span>
                </div>
                {(status === "downloading" || status === "moving") && entry.task!.speed > 0 && (
                  <div className="text-right">
                    <p className="text-[12px] text-gray-400 font-mono tabular-nums">
                      {formatBytes(entry.task!.speed, 0)}/s
                    </p>
                    {entry.task!.eta && (
                      <span className="inline-flex items-baseline gap-1 text-gray-500 font-bold tabular-nums">
                        <span className="text-[10px] opacity-60">còn</span>
                        <span className={`text-[20px] ${cfg.textClass}`}>{formatEta(entry.task!.eta)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : status === "incomplete_dl" && incompTask ? (
            <div className="mt-1! pt-3! border-t border-white/5">
              <div className="flex items-center gap-2 mb-1.5!">
                <div className="inline-flex items-center gap-1.5 rounded-lg px-2.5! py-1! bg-sky-400/12">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-sky-400">{t(STATUS_CONFIG.incomplete_dl.labelId as any)}</span>
                </div>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[24px] font-bold font-mono tabular-nums leading-none text-sky-400">
                  {incompTask.progress}
                </span>
                <span className="text-[11px] font-medium text-sky-400 opacity-60">%</span>
              </div>
            </div>
          ) : (
            /* ── Non-progress status ── */
            <div className="mt-1! pt-3! flex items-center justify-between">
              <div className={`inline-flex items-center gap-2 rounded-lg px-3! py-1.5! ${cfg.pillClass}`}>
                <div
                  className={`w-1.75 h-1.75 rounded-full ${cfg.dotClass} shrink-0 ${cfg.animated ? "animate-pulse" : ""}`}
                />
                <span className={`text-[13px] font-semibold ${cfg.textClass}`}>{t(cfg.labelId as any)}</span>
              </div>
            </div>
          )}

          {status === "error" && entry.task?.error && (
            <p className="text-[11px] text-red-400/75 mt-1.5! truncate" title={entry.task.error}>
              {entry.task.error}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
});
