import { type FC, memo } from "react";
import type { SectionProps } from "./types";

const Section: FC<SectionProps> = memo(function Section({ icon: Icon, title, children }) {
  return (
    <div className="mb-8! rounded-xl border border-white/6 bg-apple-tile-1 overflow-hidden">
      <div className="flex items-center gap-3! px-6! py-4! border-b border-white/6 bg-white/2">
        <div className="w-8 h-8 rounded-lg bg-apple-primary/10 flex items-center justify-center text-apple-primary-on-dark shrink-0">
          <Icon />
        </div>
        <span className="text-[14px] font-semibold text-[#e8edf2] tracking-[0.01em]">
          {title}
        </span>
      </div>
      <div className="divide-y divide-white/[0.07]">
        {children}
      </div>
    </div>
  )
});

export { Section };
