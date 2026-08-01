import { memo } from "react";

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

export function formatEta(sec?: number): string {
  if (!sec || sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

const dateFormat = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return new Intl.DateTimeFormat("en", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
})();

export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return dateFormat.format(new Date(dateStr));
}

export const Spinner = memo(function Spinner({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin transform-gpu will-change-transform ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
});
