import { type FC, memo } from "react";
import type { ToggleProps } from "./types";

const Toggle: FC<ToggleProps> = memo(({ on, onChange, disabled = false }) => (
  <div
    role="switch"
    aria-checked={on}
    onClick={() => !disabled && onChange(!on)}
    className={[
      "relative shrink-0 w-11 h-6 rounded-full border transition-all duration-200 select-none",
      on ? "bg-[#0066cc] border-[#0066cc]" : "bg-white/[0.1] border-white/[0.06]",
      disabled ? "opacity-30 cursor-default" : "cursor-pointer",
    ].join(" ")}
  >
    <span
      className={[
        "absolute top-1/2 -translate-y-1/2 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200",
        on ? "translate-x-5" : "translate-x-0",
      ].join(" ")}
    />
  </div>
));

export { Toggle };
