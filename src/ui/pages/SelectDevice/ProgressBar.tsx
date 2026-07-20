import { memo } from "react";
import type { TaskStatus } from "@custom-type/downloader";

const PROGRESS_COLOR_MAP: Partial<Record<string, string>> = {
  downloading: "bg-[#0066cc]",
  paused: "bg-orange-400",
  verifying: "bg-violet-400",
  moving: "bg-cyan-400",
  completed: "bg-emerald-400",
  error: "bg-red-400",
  incomplete_dl: "bg-sky-400",
};

export const ProgressBar = memo(function ProgressBar({ value, status }: { value: number; status: TaskStatus | "incomplete_dl" }) {
  const color = PROGRESS_COLOR_MAP[status] ?? "bg-[#0066cc]";
  const animated = ["downloading", "verifying", "moving"].includes(status);

  return (
    <div className="w-full h-1 bg-white/8 rounded-full overflow-hidden mt-2.5!">
      <div
        className={`h-full rounded-full transition-all duration-150 ${color} ${animated ? "relative overflow-hidden" : ""}`}
        style={{ width: `${value}%` }}
      >
        {animated && (
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
        )}
      </div>
    </div>
  );
});
