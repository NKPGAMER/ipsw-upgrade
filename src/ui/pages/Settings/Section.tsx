import { type FC, memo } from "react";
import type { SectionProps } from "./types";

const Section: FC<SectionProps> = memo(({ icon: Icon, title, children }) => (
  <div className="mb-8! rounded-xl border border-white/[0.06] bg-[#272729] overflow-hidden">
    <div className="flex items-center gap-3! px-6! py-4! border-b border-white/[0.06] bg-white/[0.02]">
      <div className="w-8 h-8 rounded-lg bg-[#0066cc]/10 flex items-center justify-center text-[#2997ff] shrink-0">
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
));

export { Section };
