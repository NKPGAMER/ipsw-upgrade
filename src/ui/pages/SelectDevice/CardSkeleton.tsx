import { memo } from "react";

export const CardSkeleton = memo(function CardSkeleton() {
  return (
    <div className="px-4! py-4.5! flex flex-col gap-0" style={{ minHeight: 168 }}>
      <div className="flex items-start gap-2.5">
        <div className="w-5 h-5 rounded bg-white/[0.06] animate-pulse mt-0.5! shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5!">
          <div className="h-4.25 w-3/4 rounded bg-white/[0.06] animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-white/[0.04] animate-pulse" />
        </div>
      </div>
      <div className="mt-2!">
        <div className="h-7 w-28 rounded-lg bg-white/[0.04] animate-pulse" />
      </div>
      <div className="mt-1! pt-3!">
        <div className="h-7 w-24 rounded-lg bg-white/[0.04] animate-pulse" />
      </div>
    </div>
  );
});
