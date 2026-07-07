import { memo } from "react";

export const ModeBadge = memo(function ModeBadge({ mode, flash }: { mode?: "turbo" | "normal"; flash?: boolean }) {
  if (!mode) return null;
  return (
    <span
      className={`inline-flex items-center rounded-lg px-3! py-1! text-[10px] font-semibold tracking-widest uppercase border transition-all duration-300 ${mode === "turbo"
        ? "bg-[#e08b1a]/12 text-[#e08b1a] border-[#e08b1a]/30"
        : "bg-[#137fec]/12 text-[#137fec] border-[#137fec]/30"
        } ${flash ? "animate-turbo-flash" : ""}`}
    >
      {mode === "turbo" ? "TURBO" : "NORMAL"}
    </span>
  );
});
