import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

interface FlyPackageAnimationProps {
  /** ID của element đích (nút Download Page) */
  targetId: string;
  /** Callback khi animation hoàn tất */
  onComplete?: () => void;
  children?: React.ReactNode;
}

interface AnimState {
  active: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  progress: number; // 0 → 1
}

// ─── Hook: useDownloadFly ─────────────────────────────────────────────────────

export function useDownloadFly(targetId: string, onComplete?: () => void) {
  const [anim, setAnim] = useState<AnimState | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [burst, setBurst] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const particleIdRef = useRef(0);
  const DURATION = 750; // ms

  const spawnTrail = useCallback((cx: number, cy: number) => {
    const colors = ["#38bdf8", "#818cf8", "#c084fc", "#f472b6"];
    const newParticles: Particle[] = Array.from({ length: 3 }, () => ({
      id: particleIdRef.current++,
      x: cx + (Math.random() - 0.5) * 12,
      y: cy + (Math.random() - 0.5) * 12,
      vx: (Math.random() - 0.5) * 2,
      vy: Math.random() * -1.5 - 0.5,
      life: 1,
      size: Math.random() * 5 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    setParticles((prev) =>
      [...prev, ...newParticles].filter((p) => p.life > 0).slice(-60)
    );
  }, []);

  const triggerBurst = useCallback((x: number, y: number) => {
    setBurst({ x, y });
    setTimeout(() => setBurst(null), 700);
  }, []);

  /** Gọi hàm này với sourceEl là nút bấm tải */
  const trigger = useCallback(
    (sourceEl: HTMLElement | null) => {
      const target = document.getElementById(targetId);
      if (!target || !sourceEl) return;

      const srcRect = sourceEl.getBoundingClientRect();
      const tgtRect = target.getBoundingClientRect();

      const startX = srcRect.left + srcRect.width / 2;
      const startY = srcRect.top + srcRect.height / 2;
      const endX = tgtRect.left + tgtRect.width / 2;
      const endY = tgtRect.top + tgtRect.height / 2;

      setAnim({ active: true, startX, startY, endX, endY, progress: 0 });
      startTimeRef.current = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startTimeRef.current;
        const t = Math.min(elapsed / DURATION, 1);
        // easeInOutCubic
        const ease =
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        setAnim((prev) => (prev ? { ...prev, progress: ease } : prev));

        // Spawn trail at current bezier position
        const cx = (startX + endX) / 2;
        const cy = Math.min(startY, endY) - Math.abs(endX - startX) * 0.35;
        const bx =
          (1 - ease) * (1 - ease) * startX +
          2 * (1 - ease) * ease * cx +
          ease * ease * endX;
        const by =
          (1 - ease) * (1 - ease) * startY +
          2 * (1 - ease) * ease * cy +
          ease * ease * endY;
        spawnTrail(bx, by);

        // Decay particles every frame
        setParticles((prev) =>
          prev
            .map((p) => ({
              ...p,
              x: p.x + p.vx,
              y: p.y + p.vy,
              life: p.life - 0.06,
            }))
            .filter((p) => p.life > 0)
        );

        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setAnim(null);
          setParticles([]);
          triggerBurst(endX, endY);
          target.classList.add("download-fly--pulse");
          setTimeout(() => {
            target.classList.remove("download-fly--pulse");
            onComplete?.();
          }, 700);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [targetId, spawnTrail, triggerBurst, onComplete]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { anim, particles, burst, trigger };
}

// ─── Package SVG ─────────────────────────────────────────────────────────────

function PackageIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
        fill="rgba(56,189,248,0.18)"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="3.27 6.96 12 12.01 20.73 6.96"
        stroke="#818cf8"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="12" y1="22.08" x2="12" y2="12"
        stroke="#c084fc"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8" y1="4.5" x2="16" y2="8.5"
        stroke="#f472b6"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

// ─── Burst Ring ───────────────────────────────────────────────────────────────

function BurstRing({ x, y }: { x: number; y: number }) {
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: `2px solid ${["#38bdf8", "#c084fc", "#f472b6"][i]}`,
            transform: "translate(-50%,-50%)",
            animation: `burstRing 0.65s ease-out ${i * 80}ms forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * DownloadFlyAnimation
 *
 * Renders a trigger button. When clicked, animates a flying package
 * from the button to the element with `targetId`, then pulses that element.
 *
 * Usage:
 *   <DownloadFlyAnimation targetId="download-page-btn" onComplete={() => console.log("done!")}>
 *     Tải về
 *   </DownloadFlyAnimation>
 *
 *   <button id="download-page-btn">Download Page</button>
 */
export default function DownloadFlyAnimation({
  targetId,
  onComplete,
  children,
}: FlyPackageAnimationProps) {
  const sourceRef = useRef<HTMLButtonElement>(null);
  const { anim, particles, burst, trigger } = useDownloadFly(targetId, onComplete);

  // Calculate bezier position for the flying package
  const getPackagePos = () => {
    if (!anim) return { x: 0, y: 0 };
    const { startX, startY, endX, endY, progress: ease } = anim;
    const cx = (startX + endX) / 2;
    const cy = Math.min(startY, endY) - Math.abs(endX - startX) * 0.35;
    const x =
      (1 - ease) * (1 - ease) * startX +
      2 * (1 - ease) * ease * cx +
      ease * ease * endX;
    const y =
      (1 - ease) * (1 - ease) * startY +
      2 * (1 - ease) * ease * cy +
      ease * ease * endY;
    return { x, y };
  };

  const pkgPos = getPackagePos();

  return (
    <>
      {/* ── Global keyframes ── */}
      <style>{`
        @keyframes burstRing {
          0%   { width: 12px;  height: 12px;  opacity: 1; }
          100% { width: 80px;  height: 80px;  opacity: 0; }
        }
        .download-fly--pulse {
          animation: dfPulse 0.6s ease-out !important;
        }
        @keyframes dfPulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0   rgba(56,189,248,0.65); }
          40%  { transform: scale(1.1);  box-shadow: 0 0 0 14px rgba(56,189,248,0.25); }
          100% { transform: scale(1);    box-shadow: 0 0 0 24px rgba(56,189,248,0); }
        }
      `}</style>

      {/* ── Trigger Button ── */}
      <button
        ref={sourceRef}
        onClick={() => trigger(sourceRef.current)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 20px",
          background: "linear-gradient(135deg,#0ea5e9,#6366f1)",
          border: "none",
          borderRadius: 10,
          color: "#fff",
          fontFamily: "'DM Mono', monospace",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.04em",
          cursor: "pointer",
          boxShadow: "0 4px 18px rgba(99,102,241,0.4)",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 6px 24px rgba(99,102,241,0.55)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 4px 18px rgba(99,102,241,0.4)";
        }}
      >
        <PackageIcon size={18} />
        {children ?? "Tải xuống"}
      </button>

      {/* ── Flying Package ── */}
      {anim?.active && (
        <div
          style={{
            position: "fixed",
            left: pkgPos.x,
            top: pkgPos.y,
            transform: `translate(-50%,-50%) rotate(${anim.progress * 360}deg) scale(${
              1 + Math.sin(anim.progress * Math.PI) * 0.4
            })`,
            pointerEvents: "none",
            zIndex: 9998,
            filter: "drop-shadow(0 0 10px rgba(129,140,248,0.9))",
          }}
        >
          <PackageIcon size={30} />
        </div>
      )}

      {/* ── Trail Particles ── */}
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "fixed",
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            background: p.color,
            opacity: p.life,
            transform: "translate(-50%,-50%)",
            pointerEvents: "none",
            zIndex: 9997,
            boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
          }}
        />
      ))}

      {/* ── Arrival Burst ── */}
      {burst && <BurstRing x={burst.x} y={burst.y} />}
    </>
  );
}