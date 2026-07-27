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

export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export const Spinner = memo(function Spinner({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin transform-gpu will-change-transform ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
});

const checkIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const closeIcon = (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

const downloadIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M12 2v13m-5-5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 20h16" strokeLinecap="round" />
  </svg>
);

const playIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14z" />
  </svg>
);

const pauseIcon = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const ICONS = {
  check: checkIcon,
  close: closeIcon,
  download: downloadIcon,
  play: playIcon,
  pause: pauseIcon,
} as const;
