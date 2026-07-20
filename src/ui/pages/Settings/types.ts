import type { FC, ReactNode } from "react";

export type Language = "en" | "vi";

export type SettingsPage = "about" | "language" | "download" | "firmware";

export interface ToggleProps {
  on: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}

export interface SectionProps {
  icon: FC;
  title: string;
  children: ReactNode;
}

export interface RowProps {
  label: string;
  desc?: string;
  dimmed?: boolean;
  right: ReactNode;
}

export interface PathRowProps {
  label: string;
  desc?: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface SidebarProps {
  active: SettingsPage;
  onNavigate: (page: SettingsPage) => void;
}

export interface SelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}
