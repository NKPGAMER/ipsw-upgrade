import { useMemo, memo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { parseIPSW, getFileNameFromUrl } from "@/core/helper";
import { formatBytes, formatDate } from "@/ui/shared";
import type { ControlAction, DeviceEntry, VerifyState } from "./types";
import { computeCardStatus } from "./utils";
import { ControlButtons } from "./ControlButtons";
import { FirmwareTable } from "./FirmwareTable";
import { PRODUCT_ICON, TASKBAR_ICON } from "./icons";

// ── Easing tokens (aligned with animations.css) ──
const EASE_DECELERATE = [0, 0, 0.2, 1] as const;
const EASE_ACCELERATE = [0.4, 0, 1, 1] as const;
const EASE_PRIMARY = [0.2, 0, 0, 1] as const;

// ── Skeleton components ──

function LatestFirmwareSkeleton() {
  return (
    <div className="space-y-3!">
      <div className="bg-white/4 rounded-xl p-4! border border-white/6">
        <div className="h-8 w-24 rounded bg-white/8 mb-3! animate-pulse" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-12 rounded-lg bg-white/5 animate-pulse" />
          <div className="h-12 rounded-lg bg-white/5 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function FirmwareListSkeleton() {
  return (
    <div className="space-y-1.5!">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-white/4 animate-pulse" />
      ))}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5! py-3! border-b border-white/8 shrink-0">
      <div className="w-7 h-7 rounded-lg bg-white/8 animate-pulse shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5!">
        <div className="h-4 w-32 rounded bg-white/8 animate-pulse" />
        <div className="h-3 w-24 rounded bg-white/5 animate-pulse" />
      </div>
    </div>
  );
}

// ── Helper ──

function latestFirmwareItem({ title, content }: { title: string, content: string }) {
  return (
    <div className="bg-white/4 rounded-lg p-2!">
      <p className="text-[12px] text-gray-600 font-semibold mb-0.5!">{title}</p>
      <p className="text-[11px] text-gray-300 font-mono truncate" title={content}>
        {content}
      </p>
    </div>
  )
}

// ── Main component ──

export const DetailPanel = memo(function DetailPanel({
  entry, product, allFiles, incompleteTasks, pendingAction, onClose, onAction, linkedDevices, linkedGroup, verifyState,
}: {
  entry: DeviceEntry;
  product: Product;
  allFiles: IPSWFile[];
  incompleteTasks: IncompleteTaskClient[];
  pendingAction: ControlAction | null;
  onClose: () => void;
  onAction: (action: ControlAction, fw?: Firmware) => void;
  linkedDevices: DeviceEntry[];
  linkedGroup?: Set<string>;
  verifyState?: VerifyState;
}) {
  const { t } = useTranslation();
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    const reset = setTimeout(() => setShowContent(false), 0);
    const timer = setTimeout(() => setShowContent(true), 180);
    return () => {
      clearTimeout(reset);
      clearTimeout(timer);
    };
  }, [entry.device.identifier]);

  const latest = entry.firmwares?.[0] ?? null;
  const status = computeCardStatus(entry, allFiles, incompleteTasks, linkedGroup);
  const isBorrowed = entry.task != null && entry.task.firmware.identifier !== entry.device.identifier;

  const incompTask = latest
    ? (() => {
        const direct = incompleteTasks.find(
          t => t.firmware.identifier === entry.device.identifier && t.firmware.buildid === latest.buildid
        );
        if (direct) return direct;
        if (linkedGroup) {
          for (const linkedId of linkedGroup) {
            if (linkedId === entry.device.identifier) continue;
            const match = incompleteTasks.find(
              t => t.firmware.identifier === linkedId && t.firmware.buildid === latest.buildid
            );
            if (match) return match;
          }
        }
        return undefined;
      })()
    : undefined;

  const corruptedFile = useMemo(() => {
    if (status !== "corrupted" || !latest) return undefined;
    const info = parseIPSW(getFileNameFromUrl(latest.url));
    if (!info) return undefined;
    return allFiles.find(f => {
      const parsed = parseIPSW(f.name);
      return parsed?.id === info.id && parsed?.build === latest.buildid;
    });
  }, [status, latest, allFiles]);

  const contentKey = entry.device.identifier;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header with skeleton-first ── */}
      <AnimatePresence mode="wait">
        {!showContent ? (
          <motion.div
            key="header-skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.12 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
          >
            <HeaderSkeleton />
          </motion.div>
        ) : (
          <motion.div
            key="header-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.05 } }}
            className="flex items-center gap-3 px-5! py-3! border-b border-white/8 shrink-0"
          >
            <div className="text-apple-primary shrink-0">{PRODUCT_ICON[product]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{entry.device.name}</p>
              <p className="text-[10px] text-gray-500 font-mono">{entry.device.identifier}</p>
            </div>
            <button onClick={onClose} aria-label="Đóng bảng chi tiết"
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-gray-500 hover:text-gray-300 flex items-center justify-center transition-colors shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scrollable content with crossfade on entry switch ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.25, ease: EASE_PRIMARY } }}
            exit={{ opacity: 0, x: -10, transition: { duration: 0.12, ease: EASE_ACCELERATE } }}
          >
            {/* ── Latest firmware section ── */}
            <div className="px-5! py-4! border-b border-white/6">
              <motion.div
                className="flex items-center gap-2 mb-3!"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: 0.04 } }}
              >
                <div className="w-0.75 h-3 rounded-full bg-apple-primary" />
                <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-widest">Phiên bản mới nhất</p>
              </motion.div>

              <AnimatePresence mode="wait">
                {!showContent ? (
                  <motion.div
                    key="skeleton"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  >
                    <LatestFirmwareSkeleton />
                  </motion.div>
                ) : entry.firmwares == null ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <LatestFirmwareSkeleton />
                  </motion.div>
                ) : latest ? (
                  <motion.div
                    key="data"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_DECELERATE, delay: 0.03 } }}
                  >
                    <div className="bg-white/4 rounded-xl p-4! border border-white/6 mb-3!">
                      <div className="flex items-start justify-between gap-3 mb-3!">
                        <div>
                          <div className="flex items-center gap-2 mb-1!">
                            <span className="text-[22px] font-bold text-white tracking-tight">{latest.version}</span>
                            {latest.signed ? (
                              <span className="text-[10px] px-2! py-0.5! rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">
                                Signed
                              </span>
                            ) : (
                              <span className="text-[10px] px-2! py-0.5! rounded-md bg-orange-500/15 text-orange-400 border border-orange-500/20 font-semibold">
                                Unsigned
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
                        {latestFirmwareItem({ title: "Name", content: getFileNameFromUrl(latest.url) || "-" })}
                        {latestFirmwareItem({ title: "Size", content: formatBytes(latest.filesize) || "-" })}
                      </div>
                    </div>

                    {!latest.signed && (
                      <motion.div
                        className="w-full flex items-center gap-2 px-3! py-2.5! mb-2! text-left text-amber-400/80 bg-amber-400/20 rounded-xl font-bold"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: 0.08 } }}
                      >
                        <p className="text-2xl">{TASKBAR_ICON.warning}</p>
                        <p className="text-[12px]">{t("pages.selectDevice.detailPanel.latestFirmwareUnsigned")}</p>
                      </motion.div>
                    )}

                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: 0.06 } }}
                    >
                      <ControlButtons
                        entry={entry}
                        status={status}
                        pendingAction={pendingAction}
                        incompTask={incompTask}
                        corruptedFile={corruptedFile}
                        verifyState={verifyState}
                        onAction={onAction}
                        readonly={isBorrowed}
                      />
                    </motion.div>

                    {linkedDevices.length > 0 && (
                      <motion.div
                        className="mt-3! bg-[#0066cc]/06 border border-apple-primary/15 rounded-xl px-3! py-2.5!"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: 0.1 } }}
                      >
                        <p className="text-[10px] font-semibold text-apple-primary mb-2! flex items-center gap-1.5">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Liên kết ({linkedDevices.length})
                        </p>
                        <div className="space-y-1!">
                          {linkedDevices.map(le => (
                            <div key={le.device.identifier} className="flex items-center gap-2 text-[10px] text-apple-primary/70">
                              <span className="w-1 h-1 rounded-full bg-apple-primary/50 shrink-0" />
                              <span className="truncate">{le.device.name}</span>
                              <span className="text-gray-600 font-mono shrink-0">{le.device.identifier}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                ) : (
                  <motion.p
                    key="empty"
                    className="text-[12px] text-gray-500 py-2!"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    Không có firmware.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* ── All versions section ── */}
            <motion.div
              className="px-5! py-4!"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: 0.08 } }}
            >
              <div className="flex items-center gap-2 mb-3!">
                <div className="w-0.75 h-3 rounded-full bg-gray-700" />
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Tất cả phiên bản</p>
                <span className="text-[10px] text-gray-600 ml-auto">
                  {entry.firmwares == null ? "…" : `${entry.firmwares.length} phiên bản`}
                </span>
              </div>

              <AnimatePresence mode="wait">
                {!showContent ? (
                  <motion.div
                    key="fw-skeleton"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  >
                    <FirmwareListSkeleton />
                  </motion.div>
                ) : entry.firmwares == null ? (
                  <motion.div
                    key="fw-loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <FirmwareListSkeleton />
                  </motion.div>
                ) : entry.firmwares.length > 0 ? (
                  <motion.div
                    key="fw-data"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.18, delay: 0.05 } }}
                  >
                    <FirmwareTable firmwares={entry.firmwares} onDownload={(fw) => onAction("download", fw)} />
                  </motion.div>
                ) : (
                  <motion.p
                    key="fw-empty"
                    className="text-[12px] text-gray-500"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    Không có dữ liệu.
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
});
