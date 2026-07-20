import { type FC, memo } from "react";
import type { RowProps } from "./types";

const Row: FC<RowProps> = memo(({ label, desc, dimmed = false, right }) => (
  <div className="flex items-center justify-between gap-6! px-6! py-5! transition-colors duration-100 hover:bg-white/[0.02]">
    <div className="flex-1 min-w-0">
      <p className={`text-[14px] font-medium text-[#e8edf2] leading-snug transition-opacity ${dimmed ? "opacity-40" : ""}`}>
        {label}
      </p>
      {desc && (
        <p className={`text-[12.5px] text-[#5a6a7a] mt-1! leading-relaxed transition-opacity ${dimmed ? "opacity-40" : ""}`}>
          {desc}
        </p>
      )}
    </div>
    <div className="shrink-0">{right}</div>
  </div>
));

export { Row };
