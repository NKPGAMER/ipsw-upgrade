import { useState, useRef, useEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { formatBytes, formatEta, Spinner } from "@/ui/shared";
import type { DeviceEntry } from "./types";
import { OS_LABEL, STATUS_CONFIG } from "./constants";
import { computeCardStatus, resolveProduct } from "./utils";
import { ModeBadge } from "./ModeBadge";
import { ProgressBar } from "./ProgressBar";
import { DeviceName } from "./DeviceName";
import { CardSkeleton } from "./CardSkeleton";
import { PRODUCT_ICON } from "./icons";
import type { TaskStatus } from "@global-type"

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

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
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
          for (const linkedId of linkedGroup) {
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

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.985)",
        transition: "opacity 0.35s cubic-bezier(0.22,1,0.36,1), transform 0.35s cubic-bezier(0.22,1,0.36,1), background 0.15s, border-color 0.15s",
        willChange: "transform, opacity",
      }}
      className={`
        group h-50 relative cursor-pointer rounded-[14px] border select-none
        ${showAurora
          ? "overflow-visible aurora-border border-transparent bg-[#0c0c0f]"
          : selected
            ? "overflow-hidden border-[#137fec]/50 bg-[#137fec]/8 shadow-[0_0_0_1px_rgba(19,127,236,0.18)]"
            : "overflow-hidden border-white/8 bg-white/4 hover:bg-white/7 hover:border-white/15"
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
              <div className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5! py-1! font-mono text-[13px]">
                <p className="text-gray-200 font-medium tracking-wide">{osLabel}</p>
                <span className="text-[#137fec] font-bold">{latestFw.version}</span>
              </div>
            </div>
          )}

          <div className="mt-1! pt-3! flex items-center justify-between">
            <div className="flex flex-start">
              <div className={`inline-flex items-center gap-2 rounded-lg px-3! py-1.5! ${cfg.pillClass}`}>
                <div
                  className={`w-1.75 h-1.75 rounded-full ${cfg.dotClass} shrink-0 ${cfg.animated ? "animate-pulse" : ""}`}
                />
                <span className={`text-[13px] font-semibold ${cfg.textClass}`}>{t(cfg.labelId as any)}</span>
              </div>

              {isOwner && inProgress && entry.task?.mode && (
                <div className="ml-2!">
                  <ModeBadge mode={entry.task.mode} flash={turboFlash} />
                </div>
              )}
            </div>

            {isOwner && inProgress && (
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

          {isOwner && inProgress && (
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
