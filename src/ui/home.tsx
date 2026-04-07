import { useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Icons ────────────────────────────────────────────────────────────────────

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" className="!w-[17px] !h-[17px]">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const DownloadIcon = ({ size = "lg" }: { size?: "sm" | "lg" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#137fec"
    strokeWidth={1.5}
    strokeLinecap="round"
    style={{ width: size === "sm" ? 16 : 40, height: size === "sm" ? 16 : 40, flexShrink: 0 }}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const StorageUsedIcon = ({ size = "lg" }: { size?: "sm" | "lg" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#137fec"
    strokeWidth={1.5}
    strokeLinecap="round"
    style={{ width: size === "sm" ? 16 : 40, height: size === "sm" ? 16 : 40, flexShrink: 0 }}
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const StorageFreeIcon = ({ size = "lg" }: { size?: "sm" | "lg" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#137fec"
    strokeWidth={1.5}
    strokeLinecap="round"
    style={{ width: size === "sm" ? 16 : 40, height: size === "sm" ? 16 : 40, flexShrink: 0 }}
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// ── Product icons ─────────────────────────────────────────────────────────────

const IPhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="7" y="2" width="10" height="20" rx="3" />
    <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth={2} />
  </svg>
);

const IPadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="5" y="2" width="14" height="20" rx="3" />
    <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth={2} />
  </svg>
);

const WatchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="7" y="7" width="10" height="10" rx="3" />
    <path d="M9 7V5h6v2" />
    <path d="M9 17v2h6v-2" />
    <line x1="17" y1="10" x2="17.01" y2="10" strokeWidth={2} />
  </svg>
);

const MacIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const VisionProIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
    <line x1="9" y1="12" x2="15" y2="12" strokeWidth={1} />
  </svg>
);

const AppleTVIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="3" y="7" width="18" height="11" rx="2" />
    <path d="M9 21h6M12 18v3" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const HomePodIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <path d="M12 3C8 3 5 6.5 5 11c0 4 2 7 7 9 5-2 7-5 7-9 0-4.5-3-8-7-8z" />
    <circle cx="12" cy="11" r="2.5" />
  </svg>
);

const IPodIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#137fec" strokeWidth={1.5}
    strokeLinecap="round" className="!w-[26px] !h-[26px]">
    <rect x="8" y="2" width="8" height="20" rx="2" />
    <circle cx="12" cy="17" r="1.5" />
    <rect x="10" y="5" width="4" height="2.5" rx="0.5" />
  </svg>
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductId =
  | "iphone"
  | "ipad"
  | "apple-watch"
  | "mac"
  | "vision-pro"
  | "apple-tv"
  | "homepod"
  | "ipod";

interface StatItem {
  label: string;
  value: string;
  unit: string;
  iconSm: React.ReactNode; // icon nhỏ 16px hiển thị rõ cạnh label
  iconLg: React.ReactNode; // icon lớn 40px làm nền mờ
}

interface Product {
  id: ProductId;
  name: string;
  sub?: string;
  icon: React.ReactNode;
  badge?: string;
}

export interface IPSWManagerProps {
  /** Thống kê lưu trữ */
  stats?: {
    fileCount: number;
    usedGB: number;
    freeGB: number;
  };
}

// ── Data ──────────────────────────────────────────────────────────────────────

const PRODUCTS: Product[] = [
  { id: "iphone",      name: "iPhone",      icon: <IPhoneIcon />,    badge: "12 tệp" },
  { id: "ipad",        name: "iPad",         icon: <IPadIcon />,      badge: "5 tệp"  },
  { id: "apple-watch", name: "Apple Watch",  icon: <WatchIcon />,     badge: "3 tệp"  },
  { id: "mac",         name: "Mac",          icon: <MacIcon />,       badge: "2 tệp"  },
  { id: "vision-pro",  name: "Vision Pro",   icon: <VisionProIcon />, sub: "visionOS" },
  { id: "apple-tv",    name: "Apple TV",     icon: <AppleTVIcon />,   sub: "tvOS"     },
  { id: "homepod",     name: "HomePod",      icon: <HomePodIcon />,   sub: "audioOS"  },
  { id: "ipod",        name: "iPod",         icon: <IPodIcon />,      sub: "Legacy"   },
];

// ── StatCard ──────────────────────────────────────────────────────────────────

const StatCard = ({ label, value, unit, iconSm, iconLg }: StatItem) => (
  <div className="relative overflow-hidden !rounded-xl bg-[#161616] border border-[#1e1e1e] !p-4 flex flex-col !gap-2">
    {/* accent top line */}
    <div className="absolute top-0 left-0 right-0 !h-[2px] bg-[#137fec] opacity-50" />
    <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-[0.6] pointer-events-none">
      {iconLg}
    </div>

    {/* label + visible icon */}
    <div className="flex items-center !gap-1.5">
      {iconSm}
      <span className="!text-[11px] text-[#666] uppercase tracking-[0.06em] font-medium">
        {label}
      </span>
    </div>

    <span className="!text-[22px] font-semibold text-[#e5e5e5] leading-none">
      {value}
      <small className="!text-[13px] text-[#888] font-normal !ml-1">{unit}</small>
    </span>
  </div>
);

// ── ProductCard ───────────────────────────────────────────────────────────────

const ProductCard = ({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="
      flex flex-col items-center !gap-2.5 !rounded-[14px]
      bg-[#161616] border border-[#1e1e1e]
      !px-3 !pt-5 !pb-4
      cursor-pointer select-none text-center w-full
      transition-all duration-150
      hover:bg-[#1a1a1a] hover:border-[#137fec55] hover:-translate-y-[1px]
      active:scale-[0.97]
    "
  >
    <div className="!w-12 !h-12 bg-[#1e1e1e] !rounded-xl flex items-center justify-center border border-[#252525] flex-shrink-0">
      {product.icon}
    </div>

    <span className="!text-[12.5px] font-medium text-[#ccc] leading-snug">
      {product.name}
    </span>

    {product.badge && (
      <span className="!text-[9.5px] font-medium tracking-[0.03em] bg-[#137fec18] text-[#137fec] border border-[#137fec30] !rounded-[5px] !px-[7px] !py-[2px]">
        {product.badge}
      </span>
    )}

    {!product.badge && product.sub && (
      <span className="!text-[10.5px] text-[#555]">{product.sub}</span>
    )}
  </button>
);

// ── home ──────────────────────────────────────────────────────────────────────

export default function home({
  stats = { fileCount: 24, usedGB: 143.2, freeGB: 312.5 },
}: IPSWManagerProps) {
  const navigate = useNavigate();
  const [_hoveredProduct, setHoveredProduct] = useState<ProductId | null>(null);

  const statItems: StatItem[] = [
    {
      label: "Tệp đã tải xuống",
      value: String(stats.fileCount),
      unit: "tệp",
      iconSm: <DownloadIcon size="sm" />,
      iconLg: <DownloadIcon size="lg" />,
    },
    {
      label: "Đã sử dụng",
      value: stats.usedGB.toFixed(1),
      unit: "GB",
      iconSm: <StorageUsedIcon size="sm" />,
      iconLg: <StorageUsedIcon size="lg" />,
    },
    {
      label: "Dung lượng trống",
      value: stats.freeGB.toFixed(1),
      unit: "GB",
      iconSm: <StorageFreeIcon size="sm" />,
      iconLg: <StorageFreeIcon size="lg" />,
    },
  ];

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0d0d0d] text-[#e5e5e5]">

      {/* ── Taskbar ─────────────────────────────────────────────────────────── */}
      <header className="
        sticky top-0 z-10 flex-shrink-0
        flex items-center justify-between
        bg-[#111] border-b border-[#1e1e1e]
        !px-6 !h-[52px]
      ">
        <h1 className="!text-[17px] font-semibold tracking-[0.01em] text-[#e5e5e5]">
          <span className="text-[#137fec]">IPSW</span> Manager
        </h1>

        <button
          type="button"
          onClick={() => navigate("/settings")}
          title="Cài đặt"
          className="
            !w-[34px] !h-[34px] !rounded-lg flex items-center justify-center
            bg-transparent border border-[#2a2a2a] text-[#999] cursor-pointer
            transition-all duration-150
            hover:bg-[#1a1a1a] hover:border-[#137fec44] hover:text-[#137fec]
          "
        >
          <SettingsIcon />
        </button>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 !p-6 md:!px-8 md:!py-7 overflow-y-auto">

        {/* Stats row */}
        <div className="grid grid-cols-3 !gap-3 !mb-7">
          {statItems.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        {/* Section label */}
        <p className="!text-[11px] text-[#555] uppercase tracking-[0.07em] font-medium !mb-3.5">
          Chọn thiết bị
        </p>

        {/* Products grid — responsive: 2 → 4 → 8 cols */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 !gap-3">
          {PRODUCTS.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onClick={() => {
                setHoveredProduct(p.id);
                navigate("/selectDevice", { state: { product: p.id } });
              }}
            />
          ))}
        </div>

      </main>
    </div>
  );
}