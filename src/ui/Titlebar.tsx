import { JSX, memo, useEffect, useCallback, useRef, useState } from "react"
import { NavigateOptions, useLocation, useNavigate } from "react-router-dom";
import { useSearchStore } from "@/stores/search-store";
import { useDebounce } from "@/hooks/useDebounce";
import { app, store, win } from "@/services/api";
import type { ControlStyle, ControlPosition } from "@/ui/pages/Settings/ThemePage";

const SettingsIcon = memo(function setiingsIcon() {
  return (
    <svg className="size-4.25!" viewBox="0 0 20 20"><path fill="currentColor" d="M11.078 0c.294 0 .557.183.656.457l.706 1.957c.253.063.47.126.654.192c.201.072.46.181.78.33l1.644-.87a.702.702 0 0 1 .832.131l1.446 1.495c.192.199.246.49.138.744l-.771 1.807c.128.235.23.436.308.604c.084.183.188.435.312.76l1.797.77c.27.115.437.385.419.674l-.132 2.075a.69.69 0 0 1-.46.605l-1.702.605c-.049.235-.1.436-.154.606a8.79 8.79 0 0 1-.298.774l.855 1.89a.683.683 0 0 1-.168.793l-1.626 1.452a.703.703 0 0 1-.796.096l-1.676-.888a7.23 7.23 0 0 1-.81.367l-.732.274l-.65 1.8a.696.696 0 0 1-.64.457L9.11 20a.697.697 0 0 1-.669-.447l-.766-2.027a14.625 14.625 0 0 1-.776-.29a9.987 9.987 0 0 1-.618-.293l-1.9.812a.702.702 0 0 1-.755-.133L2.22 16.303a.683.683 0 0 1-.155-.783l.817-1.78a9.517 9.517 0 0 1-.302-.644a14.395 14.395 0 0 1-.3-.811L.49 11.74a.69.69 0 0 1-.49-.683l.07-1.921a.688.688 0 0 1 .392-.594L2.34 7.64c.087-.319.163-.567.23-.748a8.99 8.99 0 0 1 .314-.712L2.07 4.46a.683.683 0 0 1 .15-.79l1.404-1.326a.702.702 0 0 1 .75-.138l1.898.784c.21-.14.4-.253.572-.344c.205-.109.479-.223.824-.346l.66-1.841A.696.696 0 0 1 8.984 0h2.094Zm-1.054 7.019c-1.667 0-3.018 1.335-3.018 2.983c0 1.648 1.351 2.984 3.018 2.984c1.666 0 3.017-1.336 3.017-2.984s-1.35-2.983-3.017-2.983Z"></path></svg>
  )
});

const DownloadIcon = memo(function downloadIcon() {
  return (
    <svg viewBox="0 0 304 384" className="size-4.25!">
      <path fill="currentColor" d="M299 128L149 277L0 128h85V0h128v128h86zM0 320h299v43H0v-43z"></path>
    </svg>
  )
});

const titlebarPages = ["/downloads", "/settings"];

const ControlButton = memo(function ControlButton({ icon, goTo, gotoOptions, onClick, visible }: { icon: JSX.Element, goTo?: string, gotoOptions?: NavigateOptions, onClick?: () => void, visible?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname.startsWith(goTo ?? "");
  const { setFromSelectDevice } = useSearchStore();
  const noDrag = visible !== false ? "no-drag" : "";

  return (
    <button
      className={`${noDrag} rounded-lg! flex items-center justify-center cursor-pointer transition-all duration-150 gap-2 p-1.5!
        ${isActive
          ? "text-apple-primary border-[#0066cc44] bg-white/8"
          : "hover:border-[#0066cc44] hover:text-apple-primary hover:bg-white/8"}
        `}
      onClick={() => {
        if (onClick) {
          onClick();
        } else if (goTo) {
          const wasOnSelect = location.pathname.startsWith("/selectDevice");
          if (wasOnSelect) setFromSelectDevice(true);
          const alreadyOnTitlebarPage = titlebarPages.some((p) => location.pathname.startsWith(p));
          navigate(goTo, { replace: alreadyOnTitlebarPage, ...gotoOptions })
        }
      }}
    >{icon}</button>
  )
});

/* ── Window Controls ─────────────────────────────── */

const MinButton = memo(function MinButton({ style, onClick }: { style: ControlStyle; onClick: () => void }) {
  if (style === "apple") {
    return (
      <button className="w-3.5 h-3.5 rounded-full bg-[#f4bf4f] hover:brightness-90 active:brightness-75 transition cursor-pointer" onClick={onClick} title="Minimize" />
    );
  }
  return (
    <button className="w-12 h-8 flex items-center justify-center hover:bg-white/10 active:bg-white/20 transition cursor-pointer" onClick={onClick} title="Minimize">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
      </svg>
    </button>
  );
});

const MaxButton = memo(function MaxButton({ style, onClick }: { style: ControlStyle; onClick: () => void }) {
  if (style === "apple") {
    return (
      <button className="w-3.5 h-3.5 rounded-full bg-[#61c554] hover:brightness-90 active:brightness-75 transition cursor-pointer" onClick={onClick} title="Maximize" />
    );
  }
  return (
    <button className="w-12 h-8 flex items-center justify-center hover:bg-white/10 active:bg-white/20 transition cursor-pointer" onClick={onClick} title="Maximize">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );
});

const CloseButton = memo(function CloseButton({ style, onClick }: { style: ControlStyle; onClick: () => void }) {
  if (style === "apple") {
    return (
      <button className="w-3.5 h-3.5 rounded-full bg-[#ed6a5e] hover:brightness-90 active:brightness-75 transition cursor-pointer" onClick={onClick} title="Close" />
    );
  }
  return (
    <button className="w-12 h-8 flex items-center justify-center hover:bg-[#e81123]/90 active:bg-[#e81123] transition cursor-pointer" onClick={onClick} title="Close">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M2 2l8 8M10 2l-8 8" />
      </svg>
    </button>
  );
});

const WindowControls = memo(function WindowControls({ style, position }: { style: ControlStyle; position: ControlPosition }) {
  const gap = style === "apple" ? "gap-2!" : "";
  const buttons = position === "left"
    ? (
      <>
        <CloseButton style={style} onClick={() => win.close()} />
        <MinButton style={style} onClick={() => win.minimize()} />
        <MaxButton style={style} onClick={() => win.maximize()} />
      </>
    )
    : (
      <>
        <MinButton style={style} onClick={() => win.minimize()} />
        <MaxButton style={style} onClick={() => win.maximize()} />
        <CloseButton style={style} onClick={() => win.close()} />
      </>
    );

  return <div className={`flex items-center ${gap} no-drag`}>{buttons}</div>;
});

export default function Titlebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isSelectDevice = location.pathname.startsWith("/selectDevice");

  const query = useSearchStore((s) => s.query);
  const searchVisible = useSearchStore((s) => s.searchVisible);
  const { setQuery, setDebouncedQuery, setGlobalMode, clearSearchQuery, reset } = useSearchStore();

  const debouncedQuery = useDebounce(query, 300);

  const [controlStyle, setControlStyle] = useState<ControlStyle>("windows");
  const [controlPosition, setControlPosition] = useState<ControlPosition>("right");

  useEffect(() => {
    store.get("controlStyle").then((v: ControlStyle | undefined) => {
      if (v) setControlStyle(v);
    });
    store.get("controlPosition").then((v: ControlPosition | undefined) => {
      if (v) setControlPosition(v);
    });
    const unsub = store.onChange((key: string, value: any) => {
      if (key === "controlStyle" && value) setControlStyle(value as ControlStyle);
      if (key === "controlPosition" && value) setControlPosition(value as ControlPosition);
    });
    return () => { unsub?.unsubscribe(); };
  }, []);

  useEffect(() => {
    setDebouncedQuery(debouncedQuery);
  }, [debouncedQuery, setDebouncedQuery]);

  // Reset search state trước — chạy trước navigation effect
  useEffect(() => {
    if (!isSelectDevice) {
      reset();
    }
  }, [isSelectDevice, reset]);

  const lastNavRef = useRef("");
  useEffect(() => {
    if (debouncedQuery.trim() && !isSelectDevice) {
      const s = useSearchStore.getState();
      if (!s.query?.trim()) return; // reset đã clear query → không navigate
      const navKey = `/selectDevice?globalSearch=${debouncedQuery}`;
      if (lastNavRef.current === navKey) return;
      lastNavRef.current = navKey;
      setGlobalMode(true);
      navigate("/selectDevice", { state: { globalSearch: true } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const handleClear = useCallback(() => {
    clearSearchQuery();
  }, [clearSearchQuery]);

  const controls = <WindowControls style={controlStyle} position={controlPosition} />;

  return (
    <header className="drag-region flex items-center justify-between bg-apple-ink text-[14px] font-bold text-slate-200 select-none"
      style={{ height: 'var(--titlebar-height)' }}>
      {/* Left */}
      <div className="flex items-center">
        {controlPosition === "left" && (
          <div className="flex items-center pr-2! pl-3!">
            {controls}
          </div>
        )}
        <div className="pt-5! pb-4! pl-3!">
          <div className="flex items-center gap-2!">
            <div className="w-7! h-7! rounded-lg! bg-apple-primary/15 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-4! h-4!">
                <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#0066cc" opacity="0.8" />
                <path d="M2 17l10 5 10-5" stroke="#0066cc" strokeWidth={1.5} fill="none" />
                <path d="M2 12l10 5 10-5" stroke="#0066cc" strokeWidth={1.5} fill="none" opacity="0.6" />
              </svg>
            </div>
            <div>
              <div className="text-[13px]! font-semibold text-white leading-tight">
                <span className="text-apple-primary">IPSW</span> Manager
              </div>
              <div className="text-[10px]! text-[#5a5a5e] leading-tight">v{app.version}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Center — search bar */}
      <div className="flex-1 flex justify-center px-4">
        <div className={`topbar-search ${searchVisible ? "" : "opacity-0 pointer-events-none"}`}>
          <div className="search-icon">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" strokeLinecap="round" />
            </svg>
          </div>
          <input
            className={`search-input ${searchVisible ? "no-drag" : ""}`}
            role="searchbox"
            aria-label="Tìm kiếm thiết bị"
            type="text"
            placeholder="Tìm thiết bị…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className={`search-clear ${searchVisible ? "no-drag" : ""}`}
              onClick={handleClear}
              style={{ display: "flex" }}
              aria-label="Xoá tìm kiếm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center pr-2!">
        <div className={`flex items-center justify-start transition-opacity duration-150 ${isSelectDevice ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <ControlButton icon={<DownloadIcon />} goTo="/downloads" visible={isSelectDevice} />
          <ControlButton icon={<SettingsIcon />} goTo="/settings" visible={isSelectDevice} />
        </div>
        {controlPosition === "right" && (
          <div className="flex items-center pl-2! pr-3!">
            {controls}
          </div>
        )}
      </div>
    </header>
  )
}
