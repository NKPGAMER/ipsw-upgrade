import { useState, useRef, useEffect, memo } from "react";

export const DeviceName = memo(function DeviceName({ name }: { name: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    const inner = innerRef.current;
    if (!track || !inner) return;
    const diff = inner.scrollWidth - track.clientWidth;
    setOverflow(diff > 0 ? diff + 8 : 0);
  }, [name]);

  return (
    <div ref={trackRef} className="w-full overflow-hidden">
      <span
        ref={innerRef}
        title={name}
        style={
          overflow > 0
            ? ({ "--scroll-dist": `-${overflow}px` } as React.CSSProperties)
            : undefined
        }
        className={`
          inline-block whitespace-nowrap text-[17px] font-semibold text-white leading-snug
          ${overflow > 0 ? "group-hover:animate-marquee" : ""}
        `}
      >
        {name}
      </span>
    </div>
  );
});
