import { useRef, useEffect } from "react";

export function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onResize(e.clientX - lastX.current);
      lastX.current = e.clientX;
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize]);

  return (
    <div onMouseDown={onMouseDown}
      className="w-4 shrink-0 flex items-center justify-center cursor-col-resize group relative z-10 select-none">
      <div className="w-px h-full bg-white/8 group-hover:bg-[#137fec]/40 transition-colors" />
      <div className="absolute w-4 h-10 rounded-full bg-white/5 group-hover:bg-[#137fec]/12 border border-white/10 group-hover:border-[#137fec]/28 flex items-center justify-center transition-all">
        <svg className="w-2.5 h-2.5 text-gray-600 group-hover:text-[#137fec] transition-colors" fill="currentColor" viewBox="0 0 8 16">
          <rect x="1" y="3" width="1.5" height="10" rx="0.75" />
          <rect x="5" y="3" width="1.5" height="10" rx="0.75" />
        </svg>
      </div>
    </div>
  );
}
