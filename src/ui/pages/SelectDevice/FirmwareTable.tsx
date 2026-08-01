import { useState, useEffect, memo } from "react";
import { formatBytes, formatDate } from "@/ui/shared";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./types";

export const FirmwareTable = memo(function FirmwareTable({
  firmwares,
  onAction,
  downloadedBuildid,
  isLegacyModel,
}: {
  firmwares: Firmware[];
  onAction: (action: ControlAction, fw?: Firmware) => void;
  downloadedBuildid: string | null;
  isLegacyModel?: boolean;
}) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 5;
  const totalPages = Math.ceil(firmwares.length / PER_PAGE);
  const items = firmwares.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const { t } = useTranslation();

  useEffect(() => { setPage(0); }, [firmwares]);

  const downloadedIndex = downloadedBuildid
    ? firmwares.findIndex(fw => fw.buildid === downloadedBuildid)
    : -1;

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-white/8">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/8 bg-white/3">
              <th className="text-left px-3! py-2! text-gray-500 font-medium">{t("firmware.version")}</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">{t("firmware.release")}</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">{t("firmware.signed")}</th>
              <th className="text-left px-3! py-2! text-gray-500 font-medium">{t("firmware.size")}</th>
              <th className="px-3! py-2!" />
            </tr>
          </thead>
          <tbody>
            {items.map((fw, i) => {
              const globalIdx = page * PER_PAGE + i;
              const isDownloaded = fw.buildid === downloadedBuildid;
              const isNewer = downloadedBuildid != null && downloadedIndex >= 0 && globalIdx < downloadedIndex;
              const isOlder = downloadedBuildid != null && downloadedIndex >= 0 && globalIdx > downloadedIndex;

              return (
                <tr
                  key={fw.buildid}
                  className={`border-b border-white/5 last:border-0 hover:bg-white/4 transition-colors ${i === 0 && page === 0 ? "bg-white/4" : ""}`}
                >
                  <td className="px-3! py-2!">
                    <span className="text-white font-mono font-medium">{fw.version}</span>
                  </td>
                  <td className="px-3! py-2! text-gray-400">{formatDate(fw.releasedate)}</td>
                  <td className="px-3! py-2!">
                    {fw.signed || isLegacyModel
                      ? <span className="text-emerald-400">✓</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-3! py-2! text-gray-400 font-mono">{formatBytes(fw.filesize)}</td>
                  <td className="px-3! py-2!">
                    {isDownloaded ? (
                      <span className="text-[10px] text-emerald-400/70 font-medium">Đã tải</span>
                    ) : isNewer ? (
                      <button
                        onClick={() => onAction("update", fw)}
                        className="px-2.5! py-1! rounded-lg bg-cyan-500/12 hover:bg-cyan-500/20 text-cyan-400 text-[10px] font-semibold border border-cyan-500/20 transition-colors"
                      >
                        Cập nhật
                      </button>
                    ) : !isOlder ? (
                      <button
                        onClick={() => onAction("download", fw)}
                        className="px-2.5! py-1! rounded-lg bg-[#0066cc]/12 hover:bg-[#0066cc]/25 text-[#2997ff] text-[10px] font-semibold border border-[#0066cc]/20 transition-colors"
                      >
                        Tải xuống
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2! px-1!">
          <span className="text-[10px] text-gray-600">Trang {page + 1} / {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-25 text-gray-400 flex items-center justify-center transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
