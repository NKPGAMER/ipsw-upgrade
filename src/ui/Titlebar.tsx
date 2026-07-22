import { JSX, memo } from "react"
import { NavigateOptions, useLocation, useNavigate } from "react-router-dom";

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

const ControlButton = memo(function ControlButton({ icon, goTo, gotoOptions, onClick }: { icon: JSX.Element, goTo?: string, gotoOptions?: NavigateOptions, onClick?: () => void }) {
    const location = useLocation();
    const navigate = useNavigate();
    const isActive = location.pathname.startsWith(goTo ?? "");

    return (
        <button
            className={`no-drag rounded-lg! flex items-center justify-center cursor-pointer transition-all duration-150 gap-2 p-1.5!
                ${isActive
                    ? "text-apple-primary border-[#0066cc44] bg-white/8"
                    : "hover:border-[#0066cc44] hover:text-apple-primary hover:bg-white/8"}
                `}
            onClick={() => {
                if (onClick) {
                    onClick();
                } else if (goTo) {
                    const alreadyOnTitlebarPage = titlebarPages.some((p) => location.pathname.startsWith(p));
                    navigate(goTo, { replace: alreadyOnTitlebarPage, ...gotoOptions })
                }
            }}
        >{icon}</button>
    )
});


export default function Titlebar() {
    const location = useLocation();
    const isSelectDevice = location.pathname.startsWith("/selectDevice");

    return (
        <header className="drag-region flex items-center justify-between bg-apple-ink text-[14px] font-bold text-slate-200 select-none pl-3!"
            style={{
                height: 'var(--titlebar-height)',
                paddingRight: 'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) + 12px)'
            }}>
            {/* Left */}
            <div className="flex items-center">
               <div className="pt-5! pb-4!">
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
            <div className="text-[10px]! text-[#5a5a5e] leading-tight">v{window.api.getVersion}</div>
          </div>
        </div>
      </div>
            </div>

            {/* Center */}
            <div>
                <span>Center</span>
            </div>

            {/* Right — always present for justify-between; buttons hidden when sidebar handles navigation */}
            <div className={`flex items-center justify-start transition-opacity duration-150 ${isSelectDevice ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <ControlButton icon={<DownloadIcon />} goTo="/downloads" />
                <ControlButton icon={<SettingsIcon />} goTo="/settings" />
            </div>
        </header>
    )
}