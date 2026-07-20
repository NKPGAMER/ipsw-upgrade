import { type FC, memo } from "react";
import type { SelectProps } from "./types";

const Select: FC<SelectProps> = memo(function Select({ value, onChange, options, disabled = false }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={[
        "bg-white/4 border border-white/6 rounded-lg px-3! py-2!",
        "text-[13px] text-[#e8edf2] outline-none cursor-pointer",
        "transition-all duration-150",
        "focus:border-apple-primary focus:bg-white/6",
        "appearance-none bg-no-repeat bg-position-[right_8px_center]",
        "pr-8!",
        disabled ? "opacity-40 cursor-default" : "",
      ].join(" ")}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7a7a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
      }}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value} className="bg-apple-tile-1 text-[#e8edf2]">
          {opt.label}
        </option>
      ))}
    </select>
  )
});

export { Select };
