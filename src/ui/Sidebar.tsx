import { memo, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DiskInfo } from "../../electron/i10r-addon/index";
import { disk } from "@/services/api";
import { formatBytes } from "./shared";

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconDevices = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-[18px]! h-[18px]!"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const IconDownload = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-[18px]! h-[18px]!"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconSettings = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-[18px]! h-[18px]!"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconDisk = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-3! h-3!"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "devices", path: "/", label: "Devices", icon: <IconDevices /> },
  {
    id: "downloads",
    path: "/downloads",
    label: "Downloads",
    icon: <IconDownload />,
  },
  {
    id: "settings",
    path: "/settings",
    label: "Settings",
    icon: <IconSettings />,
  },
];

// ── NavButton ─────────────────────────────────────────────────────────────────

const NavButton = memo(function NavButton({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative flex items-center gap-2.5! w-full px-3! py-2!
        rounded-lg text-[13px] font-medium border-none cursor-pointer
        transition-all duration-150 text-left group
        ${
          isActive
            ? "bg-apple-primary/15 text-apple-primary-on-dark"
            : "bg-transparent text-[#8a8a8e] hover:bg-white/5 hover:text-[#c8c8c8]"
        }
      `}
    >
      <span
        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px]! h-4! rounded-r-full bg-apple-primary transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)]"
        style={{ opacity: isActive ? 1 : 0 }}
      />
      <span
        className={
          isActive
            ? "text-apple-primary-on-dark"
            : "text-[#5a5a5e] group-hover:text-[#8a8a8e]"
        }
      >
        {item.icon}
      </span>
      {item.label}
    </button>
  );
});

// ── DiskBar ───────────────────────────────────────────────────────────────────

const DiskBar = memo(function DiskBar({ disk }: { disk: DiskInfo }) {
  const usedPct =
    disk.totalSpace > 0
      ? Math.round((disk.usedSpace / disk.totalSpace) * 100)
      : 0;
  const freeFormatted = formatBytes(disk.freeSpace);
  const totalFormatted = formatBytes(disk.totalSpace);

  const barColor =
    usedPct >= 90
      ? "bg-[#ff3b30]"
      : usedPct >= 75
        ? "bg-[#ff9500]"
        : "bg-apple-primary";

  return (
    <div className="px-3! py-2! rounded-lg bg-white/[0.03] border border-white/[0.04] hover:bg-white/[0.05] transition-colors duration-150">
      <div className="flex items-center gap-1.5! mb-1.5!">
        <span className="text-[#5a5a5e]">
          <IconDisk />
        </span>
        <span className="text-[11px] font-medium text-[#b0b0b4] truncate flex-1 min-w-0">
          {disk.name || disk.mountPoint}
        </span>
        <span className="text-[10px] font-mono text-[#5a5a5e] shrink-0">
          {disk.mountPoint}
        </span>
      </div>
      <div className="w-full h-1 bg-white/6 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${usedPct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        />
      </div>
      <div className="flex items-center justify-between mt-1!">
        <span className="text-[10px] text-[#5a5a5e]">
          {freeFormatted} trống
        </span>
        <span className="text-[10px] font-mono text-[#4a4a4e]">
          {totalFormatted}
        </span>
      </div>
    </div>
  );
});

// ── DiskSection ───────────────────────────────────────────────────────────────

const DiskSection = memo(function DiskSection() {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [page, setPage] = useState(0);
  const itemsPerPage = 2;

  useEffect(() => {
    disk
      .getAllDisk()
      .then((d) => d && setDisks(d))
      .catch(console.error);
  }, []);

  if (disks.length === 0) return null;

  const totalPages = Math.ceil(disks.length / itemsPerPage);
  const safePage = Math.min(page, totalPages - 1);
  const pageDisks = disks.slice(safePage * itemsPerPage, (safePage + 1) * itemsPerPage);

  return (
    <div className="flex flex-col gap-1.5!">
      <div className="flex items-center justify-between px-1! mb-0.5!">
        <div className="flex items-center gap-1.5!">
          <span className="text-[#5a5a5e]">
            <IconDisk />
          </span>
          <span className="text-[10px] font-semibold text-[#5a5a5e] uppercase tracking-[0.08em]">
            Ổ đĩa
          </span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex items-center justify-center w-5 h-5 rounded-md border-none bg-white/4 hover:bg-white/8 disabled:opacity-20 disabled:pointer-events-none text-[#8a8a8e] cursor-pointer transition-colors text-[11px] font-mono"
            >
              ‹
            </button>
            <span className="text-[10px] font-mono text-[#5a5a5e] min-w-[18px] text-center">
              {safePage + 1}/{totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="flex items-center justify-center w-5 h-5 rounded-md border-none bg-white/4 hover:bg-white/8 disabled:opacity-20 disabled:pointer-events-none text-[#8a8a8e] cursor-pointer transition-colors text-[11px] font-mono"
            >
              ›
            </button>
          </div>
        )}
      </div>
      <AnimatePresence mode="wait">
        {pageDisks.map((disk, i) => (
          <motion.div
            key={disk.id || `disk-${i}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.25,
              ease: [0.16, 1, 0.3, 1],
              delay: i * 0.04,
            }}
          >
            <DiskBar disk={disk} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default memo(function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = useCallback(
    (path: string) => {
      if (path === "/") return location.pathname === "/";
      return location.pathname.startsWith(path);
    },
    [location.pathname],
  );

  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="
        w-[200px]! shrink-0 h-full
        flex flex-col
        bg-[#1c1c1e]/80 backdrop-blur-xl
        border-r border-white/[0.06]
        select-none no-drag
      "
    >
      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-0.5! px-2! overflow-y-auto min-h-0">
        <div className="px-2! mb-1.5!">
          <span className="text-[10px] font-semibold text-[#5a5a5e] uppercase tracking-[0.08em]">
            Điều hướng
          </span>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={isActive(item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}

        {/* Separator */}
        <div className="my-3! mx-2! h-px bg-white/[0.06]" />

        {/* Disks */}
        <div className="px-1!">
          <DiskSection />
        </div>
      </nav>

      {/* Bottom fade */}
      <div className="shrink-0 h-4! bg-gradient-to-t from-[#1c1c1e]/80 to-transparent pointer-events-none" />
    </motion.aside>
  );
});
