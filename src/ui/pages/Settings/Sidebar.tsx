import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";
import { IconAbout, IconLanguage, IconDownload, IconSoftware, IconTheme } from "./icons";
import type { SidebarProps, SettingsPage } from "./types";

interface NavItem {
  id: SettingsPage;
  icon: FC;
  labelKey: string;
}

const navItems: NavItem[] = [
  { id: "about", icon: IconAbout, labelKey: "setting.sidebar.about" },
  { id: "language", icon: IconLanguage, labelKey: "setting.sidebar.language" },
  { id: "download", icon: IconDownload, labelKey: "setting.sidebar.download" },
  { id: "firmware", icon: IconSoftware, labelKey: "setting.sidebar.firmware" },
  { id: "theme", icon: IconTheme, labelKey: "setting.sidebar.theme" },
];

const Sidebar: FC<SidebarProps> = memo(function Sedebar({ active, onNavigate }) {
  const { t } = useTranslation();

  return (
    <nav className="w-52 shrink-0 h-full overflow-y-auto bg-[#1e1e20] border-r border-white/6 flex flex-col pt-6! pb-4!">
      <div className="px-4! mb-6!">
        <h2 className="text-[13px] font-semibold text-[#5a6a7a] uppercase tracking-[0.08em]">
          {t("setting.title")}
        </h2>
      </div>
      <div className="flex-1 flex flex-col gap-0.5 px-2!">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={[
                "flex items-center gap-3! w-full px-3! py-2.5! rounded-lg text-[13px] font-medium border-none cursor-pointer transition-all duration-150 text-left",
                isActive
                  ? "bg-apple-primary/15 text-apple-primary-on-dark"
                  : "bg-transparent text-apple-ink-muted-48 hover:bg-white/4 hover:text-[#c8c8c8]",
              ].join(" ")}
            >
              <span className={isActive ? "text-apple-primary-on-dark" : "text-[#5a6a7a]"}>
                <Icon />
              </span>
              {t(item.labelKey as any)}
            </button>
          );
        })}
      </div>
    </nav>
  );
});

export { Sidebar };
