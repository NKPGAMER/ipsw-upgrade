import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  children: ReactNode;
  label: string;
  position?: TooltipPosition;
  delay?: number;
  /** Hex or CSS color — glow sẽ lấy màu này. Mặc định "#6b6bff" */
  glowColor?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GAP = 10;
const PADDING = 10;
const SLIDE_DIST = 7; // px translate khi animate vào/ra

// ─── Arrow ────────────────────────────────────────────────────────────────────

type ArrowDir = "up" | "down" | "left" | "right";

const ARROW_DIR: Record<TooltipPosition, ArrowDir> = {
  top: "down",
  bottom: "up",
  left: "right",
  right: "left",
};

function Arrow({ direction }: { direction: ArrowDir }) {
  const fill = "#18181c";
  const stroke = "rgba(255,255,255,0.10)";
  const sw = "0.5";

  switch (direction) {
    case "down":
      return (
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
          <path d="M1 0.5 L8 9 L15 0.5" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      );
    case "up":
      return (
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
          <path d="M1 9.5 L8 1 L15 9.5" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      );
    case "right":
      return (
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M0.5 1 L9 8 L0.5 15" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      );
    default: // left
      return (
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M9.5 1 L1 8 L9.5 15" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      );
  }
}

// ─── Arrow position ───────────────────────────────────────────────────────────

function getArrowStyle(
  pos: TooltipPosition,
  anchorRect: DOMRect,
  tooltipLeft: number,
  tooltipTop: number,
  tooltipW: number,
  tooltipH: number
): CSSProperties {
  const aX = anchorRect.left + anchorRect.width / 2;
  const aY = anchorRect.top + anchorRect.height / 2;

  if (pos === "top") {
    const left = Math.min(Math.max(aX - tooltipLeft - 8, 8), tooltipW - 24);
    return { position: "absolute", bottom: -9, left, width: 16, height: 10 };
  }
  if (pos === "bottom") {
    const left = Math.min(Math.max(aX - tooltipLeft - 8, 8), tooltipW - 24);
    return { position: "absolute", top: -9, left, width: 16, height: 10 };
  }
  if (pos === "left") {
    const top = Math.min(Math.max(aY - tooltipTop - 8, 8), tooltipH - 24);
    return { position: "absolute", right: -9, top, width: 10, height: 16 };
  }
  // right
  const top = Math.min(Math.max(aY - tooltipTop - 8, 8), tooltipH - 24);
  return { position: "absolute", left: -9, top, width: 10, height: 16 };
}

// ─── Animation translate theo hướng ──────────────────────────────────────────

function getEnterTranslate(pos: TooltipPosition): string {
  switch (pos) {
    case "top":    return `translateY(${SLIDE_DIST}px)`;
    case "bottom": return `translateY(-${SLIDE_DIST}px)`;
    case "left":   return `translateX(${SLIDE_DIST}px)`;
    case "right":  return `translateX(-${SLIDE_DIST}px)`;
  }
}

// ─── Compute position ─────────────────────────────────────────────────────────

function computePosition(
  preferred: TooltipPosition,
  anchorRect: DOMRect,
  tooltipRect: DOMRect
): { pos: TooltipPosition; left: number; top: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const tw = tooltipRect.width;
  const th = tooltipRect.height;

  const spaceTop    = anchorRect.top;
  const spaceBottom = H - anchorRect.bottom;
  const spaceLeft   = anchorRect.left;
  const spaceRight  = W - anchorRect.right;

  let pos = preferred;

  if      (pos === "top"    && spaceTop    < th + GAP + PADDING) pos = spaceBottom >= th + GAP + PADDING ? "bottom" : spaceRight > spaceLeft ? "right" : "left";
  else if (pos === "bottom" && spaceBottom < th + GAP + PADDING) pos = spaceTop    >= th + GAP + PADDING ? "top"    : spaceRight > spaceLeft ? "right" : "left";
  else if (pos === "left"   && spaceLeft   < tw + GAP + PADDING) pos = spaceRight  >= tw + GAP + PADDING ? "right"  : spaceBottom > spaceTop ? "bottom" : "top";
  else if (pos === "right"  && spaceRight  < tw + GAP + PADDING) pos = spaceLeft   >= tw + GAP + PADDING ? "left"   : spaceBottom > spaceTop ? "bottom" : "top";

  const aX = anchorRect.left + anchorRect.width / 2;
  const aY = anchorRect.top  + anchorRect.height / 2;

  const coords: Record<TooltipPosition, { left: number; top: number }> = {
    top:    { left: Math.max(PADDING, Math.min(W - tw - PADDING, aX - tw / 2)), top: anchorRect.top    - th - GAP },
    bottom: { left: Math.max(PADDING, Math.min(W - tw - PADDING, aX - tw / 2)), top: anchorRect.bottom + GAP },
    left:   { left: anchorRect.left  - tw - GAP, top: Math.max(PADDING, Math.min(H - th - PADDING, aY - th / 2)) },
    right:  { left: anchorRect.right + GAP,      top: Math.max(PADDING, Math.min(H - th - PADDING, aY - th / 2)) },
  };

  return { pos, ...coords[pos] };
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface LayoutState {
  pos: TooltipPosition;
  left: number;
  top: number;
  tooltipW: number;
  tooltipH: number;
  anchorRect: DOMRect;
  ready: boolean; // đã đo xong, có thể hiển thị
}

export function Tooltip({
  children,
  label,
  position = "bottom",
  delay = 0,
  glowColor = "#6b6bff",
}: TooltipProps) {
  const anchorRef  = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "mounted" — tooltip có trong DOM (cần để measure)
  // "visible"  — đã ready + animate in
  const [mounted, setMounted]   = useState(false);
  const [visible, setVisible]   = useState(false);
  const [layout,  setLayout]    = useState<LayoutState | null>(null);

  // ── Show / Hide ────────────────────────────────────────────────────────────

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setLayout(null);   // reset để đo lại
      setMounted(true);  // mount vào DOM (invisible) để measure
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setVisible(false);
    // Unmount sau khi animation kết thúc (~200ms)
    hideTimer.current = setTimeout(() => setMounted(false), 200);
  }, []);

  useEffect(() => () => {
    if (hideTimer.current)  clearTimeout(hideTimer.current);
    if (showTimer.current)  clearTimeout(showTimer.current);
  }, []);

  // ── Measure sau khi mount (sync trước paint) ───────────────────────────────

  useLayoutEffect(() => {
    if (!mounted || layout?.ready) return;
    const anchor  = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;

    const anchorRect  = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const { pos, left, top } = computePosition(position, anchorRect, tooltipRect);

    setLayout({
      pos,
      left,
      top,
      tooltipW: tooltipRect.width,
      tooltipH: tooltipRect.height,
      anchorRect,
      ready: true,
    });

    // Trigger animate in sau 1 frame
    requestAnimationFrame(() => setVisible(true));
  }, [mounted, layout?.ready, position]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!mounted) {
    return (
      <div
        ref={anchorRef}
        className="relative inline-flex items-center justify-center"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </div>
    );
  }

  const pos = layout?.pos ?? position;
  const isReady = layout?.ready ?? false;

  // Glow: drop-shadow + box-shadow kết hợp
  const glowShadow = `0 0 18px 3px ${glowColor}55, 0 0 40px 8px ${glowColor}22`;
  const dropShadow = `drop-shadow(0 8px 24px rgba(0,0,0,0.22)) drop-shadow(0 2px 6px rgba(0,0,0,0.16))`;

  const enterTranslate = getEnterTranslate(pos);

  const tooltipStyle: CSSProperties = {
    position:      "fixed",
    left:          isReady ? layout!.left : -9999,
    top:           isReady ? layout!.top  : -9999,
    zIndex:        9999,
    pointerEvents: "none",
    // Opacity + slide animation
    opacity:       visible && isReady ? 1 : 0,
    transform:     visible && isReady ? "scale(1) translate(0,0)" : `scale(0.92) ${enterTranslate}`,
    transition:    visible
      ? "opacity 0.18s cubic-bezier(0.16,1,0.3,1), transform 0.2s cubic-bezier(0.16,1,0.3,1)"
      : "opacity 0.15s ease, transform 0.15s ease",
    filter:        dropShadow,
    willChange:    "opacity, transform",
  };

  const bodyStyle: CSSProperties = {
    padding:      "7px 13px",
    borderRadius: 9,
    background:   "#18181c",
    border:       `0.5px solid rgba(255,255,255,0.12)`,
    color:        "#e8e8ec",
    fontSize:     12.5,
    fontWeight:   500,
    whiteSpace:   "nowrap",
    lineHeight:   1.5,
    // Colored glow trên body
    boxShadow:    visible && isReady ? glowShadow : "none",
    transition:   "box-shadow 0.25s ease",
  };

  const arrowStyle = isReady
    ? getArrowStyle(pos, layout!.anchorRect, layout!.left, layout!.top, layout!.tooltipW, layout!.tooltipH)
    : { display: "none" };

  const tooltipEl = (
    <div ref={tooltipRef} style={tooltipStyle}>
      <div style={arrowStyle}>
        <Arrow direction={ARROW_DIR[pos]} />
      </div>
      <div style={bodyStyle}>{label}</div>
    </div>
  );

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex items-center justify-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {createPortal(tooltipEl, document.body)}
    </div>
  );
}