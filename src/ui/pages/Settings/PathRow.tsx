import { type FC, memo } from "react";
import { IconFolder } from "./icons";
import type { PathRowProps } from "./types";

const PathRow: FC<PathRowProps> = memo(({ label, desc, value, onChange, onBrowse, disabled = false, placeholder }) => (
  <div className="flex flex-col gap-3! px-6! py-5! transition-colors duration-100 hover:bg-white/2">
    <div>
      <p className={`text-[14px] font-medium text-[#e8edf2] leading-snug transition-opacity ${disabled ? "opacity-40" : ""}`}>
        {label}
      </p>
      {desc && (
        <p className={`text-[12.5px] text-[#5a6a7a] mt-1! leading-relaxed transition-opacity ${disabled ? "opacity-40" : ""}`}>
          {desc}
        </p>
      )}
    </div>
    <div className="flex gap-2! items-center">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={[
          "flex-1 min-w-0 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3! py-2!",
          "text-[13px] font-mono text-[#7a7a7a] outline-none caret-[#0066cc]",
          "transition-all duration-150",
          "focus:border-[#0066cc] focus:text-white focus:bg-white/[0.06]",
          disabled ? "opacity-40 cursor-default" : "",
        ].join(" ")}
      />
      <button
        disabled={disabled}
        onClick={onBrowse}
        className={[
          "flex items-center gap-2! px-4! py-2! rounded-lg border border-white/[0.06]",
          "bg-white/[0.04] text-[#7a7a7a] text-[13px] font-medium whitespace-nowrap",
          "transition-all duration-150",
          disabled
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-[rgba(19,127,236,0.12)] hover:border-[#0066cc] hover:text-[#0066cc] cursor-pointer",
        ].join(" ")}
      >
        <IconFolder />
      </button>
    </div>
  </div>
));

export { PathRow };
