import type { CardTask } from "./types";

export interface StatusConfig {
  labelId: string;
  pillClass: string;
  dotClass: string;
  textClass: string;
  animated?: boolean;
}

export const STATUS_LABEL: Record<CardTask, string> = {
  none:          "status_label.none",
  queued:        "status_label.queued",
  downloading:   "status_label.downloading",
  downloaded:    "status_label.downloaded",
  paused:        "status_label.paused",
  completed:     "status_label.completed",
  error:         "status_label.error",
  verifying:     "status_label.verifying",
  moving:        "status_label.moving",
  cancelled:     "status_label.cancelled",
  old:           "status_label.old",
  corrupted:     "status_label.corrupted",
  incomplete_dl: "status_label.incomplete_dl"
}

export const STATUS_COLOR: Record<CardTask, string> = {
  none:          "text-gray-500",
  queued:        "text-yellow-400",
  downloading:   "text-[#137fec]",
  paused:        "text-orange-400",
  completed:     "text-emerald-400",
  downloaded:    "text-emerald-400",
  error:         "text-red-400",
  verifying:     "text-purple-400",
  moving:        "text-cyan-400",
  cancelled:     "text-gray-400",
  old:           "text-cyan-400",
  corrupted:     "text-amber-400",
  incomplete_dl: "text-sky-400",
};

export const OS_LABEL: Record<Product, string> = {
  iphone:        "iOS",
  ipad:          "iPadOS",
  mac:           "macOS",
  watch:         "watchOS",
  tv:            "tvOS",
  realitydevice: "visionOS",
  homepod:       "Version",
  ipod:          "Version",
};

export interface StatusConfig {
  labelId: string;
  pillClass: string;
  dotClass: string;
  textClass: string;
  animated?: boolean;
}

export const STATUS_CONFIG: Record<CardTask, StatusConfig> = {
  none: {
    labelId: "status_config.none",
    pillClass: "bg-gray-500/15",
    dotClass: "bg-gray-500",
    textClass: "text-gray-400",
  },

  queued: {
    labelId: "status_config.queued",
    pillClass: "bg-yellow-400/12",
    dotClass: "bg-yellow-400",
    textClass: "text-yellow-400",
  },

  downloading: {
    labelId: "status_config.downloading",
    pillClass: "bg-[#137fec]/15",
    dotClass: "bg-[#137fec]",
    textClass: "text-[#137fec]",
    animated: true,
  },

  paused: {
    labelId: "status_config.paused",
    pillClass: "bg-orange-400/12",
    dotClass: "bg-orange-400",
    textClass: "text-orange-400",
  },

  completed: {
    labelId: "status_config.completed",
    pillClass: "bg-emerald-400/12",
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-400",
  },

  downloaded: {
    labelId: "status_config.downloaded",
    pillClass: "bg-emerald-400/12",
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-400",
  },

  error: {
    labelId: "status_config.error",
    pillClass: "bg-red-400/12",
    dotClass: "bg-red-400",
    textClass: "text-red-400",
  },

  verifying: {
    labelId: "status_config.verifying",
    pillClass: "bg-violet-400/12",
    dotClass: "bg-violet-400",
    textClass: "text-violet-400",
    animated: true,
  },

  moving: {
    labelId: "status_config.moving",
    pillClass: "bg-cyan-400/10",
    dotClass: "bg-cyan-400",
    textClass: "text-cyan-400",
    animated: true,
  },

  cancelled: {
    labelId: "status_config.cancelled",
    pillClass: "bg-gray-500/15",
    dotClass: "bg-gray-500",
    textClass: "text-gray-400",
  },

  old: {
    labelId: "status_config.old",
    pillClass: "bg-cyan-400/10",
    dotClass: "bg-cyan-400",
    textClass: "text-cyan-400",
  },

  corrupted: {
    labelId: "status_config.corrupted",
    pillClass: "bg-amber-400/12",
    dotClass: "bg-amber-400",
    textClass: "text-amber-400",
  },

  incomplete_dl: {
    labelId: "status_config.incomplete_dl",
    pillClass: "bg-sky-400/12",
    dotClass: "bg-sky-400",
    textClass: "text-sky-400",
  },
};
