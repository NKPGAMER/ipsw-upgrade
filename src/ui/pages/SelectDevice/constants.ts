import type { CardTask } from "./types";

export const STATUS_LABEL: Record<CardTask | "none", string> = {
  none: "Chưa tải", queued: "Đang chờ", downloading: "Đang tải",
  paused: "Đã tạm dừng", completed: "Đã tải", downloaded: "Đã tải",
  error: "Lỗi", verifying: "Đang xác minh", moving: "Đang di chuyển",
  cancelled: "Đã huỷ", old: "Có phiên bản mới", corrupted: "Không hoàn chỉnh",
  incomplete_dl: "Chưa tải xong",
};

export const STATUS_COLOR: Record<CardTask | "none", string> = {
  none: "text-gray-500", queued: "text-yellow-400", downloading: "text-[#137fec]",
  paused: "text-orange-400", completed: "text-emerald-400", downloaded: "text-emerald-400",
  error: "text-red-400", verifying: "text-purple-400", moving: "text-cyan-400",
  cancelled: "text-gray-400", old: "text-cyan-400", corrupted: "text-amber-400", incomplete_dl: "text-sky-400",
};

export const OS_LABEL: Record<Product, string> = {
  iphone: "iOS",
  ipad: "iPadOS",
  mac: "macOS",
  watch: "watchOS",
  tv: "tvOS",
  realitydevice: "visionOS",
  homepod: "Version",
  ipod: "iOS",
};

export const STATUS_CONFIG: Record<CardTask | "none", {
  label: string;
  pill: string;
  dot: string;
  text: string;
  animate?: boolean;
}> = {
  none: { label: "Chưa tải", pill: "bg-gray-500/15", dot: "bg-gray-500", text: "text-gray-400" },
  queued: { label: "Đang chờ", pill: "bg-yellow-400/12", dot: "bg-yellow-400", text: "text-yellow-400" },
  downloading: { label: "Đang tải", pill: "bg-[#137fec]/15", dot: "bg-[#137fec]", text: "text-[#137fec]", animate: true },
  paused: { label: "Đã tạm dừng", pill: "bg-orange-400/12", dot: "bg-orange-400", text: "text-orange-400" },
  completed: { label: "Đã tải", pill: "bg-emerald-400/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  downloaded: { label: "Đã tải", pill: "bg-emerald-400/12", dot: "bg-emerald-400", text: "text-emerald-400" },
  error: { label: "Lỗi", pill: "bg-red-400/12", dot: "bg-red-400", text: "text-red-400" },
  verifying: { label: "Đang xác minh", pill: "bg-violet-400/12", dot: "bg-violet-400", text: "text-violet-400", animate: true },
  moving: { label: "Đang di chuyển", pill: "bg-cyan-400/10", dot: "bg-cyan-400", text: "text-cyan-400", animate: true },
  cancelled: { label: "Đã huỷ", pill: "bg-gray-500/15", dot: "bg-gray-500", text: "text-gray-400" },
  old: { label: "Có phiên bản mới", pill: "bg-cyan-400/10", dot: "bg-cyan-400", text: "text-cyan-400" },
  corrupted: { label: "Không hoàn chỉnh", pill: "bg-amber-400/12", dot: "bg-amber-400", text: "text-amber-400" },
  incomplete_dl: { label: "Chưa tải xong", pill: "bg-sky-400/12", dot: "bg-sky-400", text: "text-sky-400" },
};
