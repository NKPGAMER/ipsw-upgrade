import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSearchStore } from "@/stores/search-store";
import { usePageLayout } from "@/ui/layout";
import { Sidebar } from "./Sidebar";
import { AboutPage } from "./AboutPage";
import { LanguagePage } from "./LanguagePage";
import { DownloadPage } from "./DownloadPage";
import { FirmwarePage } from "./FirmwarePage";
import { ThemePage } from "./ThemePage";
import type { SettingsPage } from "./types";

const pages: Record<SettingsPage, JSX.Element> = {
  about: <AboutPage />,
  language: <LanguagePage />,
  download: <DownloadPage />,
  firmware: <FirmwarePage />,
  theme: <ThemePage />,
};

export default function SettingsApp(): JSX.Element {
  usePageLayout("default");
  const [activePage, setActivePage] = useState<SettingsPage>("about");
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fromSelectDevice = useSearchStore((s) => s.fromSelectDevice);

  return (
    <div className="size-full flex bg-apple-tile-3 text-white overflow-hidden">
      <Sidebar active={activePage} onNavigate={setActivePage} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-8! py-5! border-b border-white/6 bg-apple-tile-3 shrink-0">
          <h1 className="text-[18px] font-bold text-[#e5e5e5] tracking-tight">
            {t("setting.title")}
          </h1>
          <button
            onClick={() => fromSelectDevice ? navigate("/selectDevice", { replace: true }) : navigate("/", { replace: true })}
            className={`w-9 h-9 flex items-center justify-center rounded-lg border border-white/6 bg-white/4 text-apple-ink-muted-48 transition-all duration-150 hover:bg-white/8 hover:border-white/10 hover:text-white cursor-pointer shrink-0 ${fromSelectDevice ? "" : "hidden"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-8! pt-6! pb-10!">
          {pages[activePage]}
        </main>
      </div>
    </div>
  );
}
