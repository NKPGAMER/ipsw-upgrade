import { JSX, useState, useEffect, useRef } from "react";
// ─── Toast System ─────────────────────────────────────────────────────────────
type ToastType = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let toastCounter = 0;
const toastListeners = new Set<(toasts: Toast[]) => void>();
let toastState: Toast[] = [];

export function pushToast(type: ToastType, message: string) {
  const id = ++toastCounter;
  toastState = [...toastState, { id, type, message }];
  toastListeners.forEach(fn => fn(toastState));
  setTimeout(() => {
    toastState = toastState.filter(t => t.id !== id);
    toastListeners.forEach(fn => fn(toastState));
  }, 4000);
}

const TOAST_ICON: Record<ToastType, JSX.Element> = {
  success: (
    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 text-[#4fa8f5] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4m0-4h.01" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const TOAST_BG: Record<ToastType, string> = {
  success: "border-emerald-500/25 bg-emerald-950/80",
  error:   "border-red-500/25 bg-red-950/80",
  info:    "border-[#137fec]/25 bg-[#0a1929]/80",
  warning: "border-orange-500/25 bg-orange-950/80",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const listener = (t: Toast[]) => { if (mountedRef.current) setToasts(t); };
    toastListeners.add(listener);
    return () => {
      mountedRef.current = false;
      toastListeners.delete(listener);
    };
  }, []);

  return (
    <div className="fixed top-5 left-5 z-9999 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-2.5 px-4.5! py-3.5! rounded-xl border backdrop-blur-md text-[12px] text-white shadow-2xl pointer-events-auto max-w-xs ${TOAST_BG[toast.type]}`}
          style={{ animation: "toastIn 0.3s cubic-bezier(0.22,1,0.36,1)" }}
        >
          {TOAST_ICON[toast.type]}
          <span className="leading-snug">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}