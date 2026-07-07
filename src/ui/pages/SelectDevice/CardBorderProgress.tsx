import { useId, memo } from "react";

export const CardBorderProgress = memo(function CardBorderProgress({
  value,
  colorClass,
  radius = 14,
  strokeWidth = 3.75
}: {
  /** 0 - 100 */
  value: number;
  colorClass: string;
  radius?: number;
  strokeWidth?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const clamped = Math.max(0, Math.min(100, value));
  const inset = strokeWidth / 2;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 ${colorClass}`}
      aria-hidden="true"
    >
      <svg className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`cbp-trail-${uid}`} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <filter id={`cbp-glow-${uid}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Rãnh nền */}
        <rect
          x={inset}
          y={inset}
          width={`calc(100% - ${strokeWidth}px)`}
          height={`calc(100% - ${strokeWidth}px)`}
          rx={radius}
          ry={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={strokeWidth}
          pathLength={100}
        />

        {/* Đoạn đã hoàn thành */}
        <rect
          x={inset}
          y={inset}
          width={`calc(100% - ${strokeWidth}px)`}
          height={`calc(100% - ${strokeWidth}px)`}
          rx={radius}
          ry={radius}
          fill="none"
          stroke={`url(#cbp-trail-${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
          style={{ transition: "stroke-dasharray 150ms linear" }}
        />
      </svg>
    </div>
  );
});