import { useState, type FC, type ReactNode, type JSX, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { state } from "../data";
import { useAppStore } from "../stores/app-store";
import utils from "../core/utils";
import { commands } from "@/bind";

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconAbout: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
  </svg>
);

const IconLanguage: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const IconDownload: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconSoftware: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const IconFolder: FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

// ─── Toggle ───────────────────────────────────────────────────────────────────

interface ToggleProps {
  on: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}

const Toggle: FC<ToggleProps> = ({ on, onChange, disabled = false }) => (
  <div
    role="switch"
    aria-checked={on}
    onClick={() => !disabled && onChange(!on)}
    className={[
      "relative shrink-0 w-11 h-6 rounded-full border transition-all duration-200 select-none",
      on ? "bg-[#137fec] border-[#137fec]" : "bg-[#363a3e] border-white/10",
      disabled ? "opacity-30 cursor-default" : "cursor-pointer",
    ].join(" ")}
  >
    <span
      className={[
        "absolute top-1/2 -translate-y-1/2 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200",
        on ? "translate-x-5" : "translate-x-0",
      ].join(" ")}
    />
  </div>
);

// ─── Section ──────────────────────────────────────────────────────────────────

interface SectionProps {
  icon: FC;
  title: string;
  children: ReactNode;
}

const Section: FC<SectionProps> = ({ icon: Icon, title, children }) => (
  <div className="mb-8! rounded-xl border border-[#1e1e1e] bg-[#161616] overflow-hidden">
    <div className="flex items-center gap-3! px-6! py-4! border-b border-white/[0.07] bg-white/2">
      <div className="w-8 h-8 rounded-lg bg-[rgba(195,208,222,0.15)] flex items-center justify-center text-[#137fec] shrink-0">
        <Icon />
      </div>
      <span className="text-[14px] font-semibold text-[#e8edf2] tracking-[0.01em]">
        {title}
      </span>
    </div>
    <div className="divide-y divide-white/[0.07]">
      {children}
    </div>
  </div>
);

// ─── Row ──────────────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  desc?: string;
  dimmed?: boolean;
  right: ReactNode;
}

const Row: FC<RowProps> = ({ label, desc, dimmed = false, right }) => (
  <div className="flex items-center justify-between gap-6! px-6! py-5! transition-colors duration-100 hover:border-[#1e1e1e]">
    <div className="flex-1 min-w-0">
      <p className={`text-[14px] font-medium text-[#e8edf2] leading-snug transition-opacity ${dimmed ? "opacity-40" : ""}`}>
        {label}
      </p>
      {desc && (
        <p className={`text-[12.5px] text-[#5a6a7a] mt-1! leading-relaxed transition-opacity ${dimmed ? "opacity-40" : ""}`}>
          {desc}
        </p>
      )}
    </div>
    <div className="shrink-0">{right}</div>
  </div>
);

// ─── PathRow ──────────────────────────────────────────────────────────────────

interface PathRowProps {
  label: string;
  desc?: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

const PathRow: FC<PathRowProps> = ({ label, desc, value, onChange, onBrowse, disabled = false, placeholder }) => (
  <div className="flex flex-col gap-3! px-6! py-5! transition-colors duration-100 hover:bg-white/2">
    <div>
      <p className={`text-[14px] font-medium text-[#e8edf2] leading-snug transition-opacity ${disabled ? "opacity-40" : ""}`}>
        {label}
      </p>
      {desc && (
        <p className={`text-[12.5px] text-[#5a6a7a] mt-1! leading-relaxed transition-opacity ${disabled ? "opacity-40" : ""}`}>
          {desc}
        </p>
      )}
    </div>
    <div className="flex gap-2! items-center">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={[
          "flex-1 min-w-0 bg-[#292a2b] border border-white/[0.07] rounded-lg px-3! py-2!",
          "text-[13px] font-mono text-[#8a9ab0] outline-none caret-[#137fec]",
          "transition-all duration-150",
          "focus:border-[#137fec] focus:text-[#e8edf2] focus:bg-[#223040]",
          disabled ? "opacity-40 cursor-default" : "",
        ].join(" ")}
      />
      <button
        disabled={disabled}
        onClick={onBrowse}
        className={[
          "flex items-center gap-2! px-4! py-2! rounded-lg border border-white/[0.07]",
          "bg-[#36393b] text-[#8a9ab0] text-[13px] font-medium whitespace-nowrap",
          "transition-all duration-150",
          disabled
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-[rgba(19,127,236,0.12)] hover:border-[#137fec] hover:text-[#137fec] cursor-pointer",
        ].join(" ")}
      >
        <IconFolder />
      </button>
    </div>
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────

type Language = "en" | "vi";

const defaultSettings = {
  downloadPath: "C:\\Downloads"
}

export default function SettingsApp(): JSX.Element {
  const [appVersion, setVersion] = useState<string>("-")
  const [language, setLanguage] = useState<Language>("vi");

  const [downloadPath, setDownloadPath] = useState<string>(defaultSettings.downloadPath);
  const [turboMode, setTurboMode] = useState<boolean>(false);

  const [normalizeName, setNormalizeName] = useState<boolean>(false);
  const [linkOutDir, setLinkOutDir] = useState<string>("IPSW_FILES");
  const [deleteOld, setDeleteOld] = useState<boolean>(false);
  const [deleteDuplicate, setDeleteDuplicate] = useState<boolean>(false);

  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Load Data
  useEffect(() => {
    // App Version
    commands.getVersion().then((v) => setVersion(v));
  }, []);

  useEffect(() => {
    const syncState = () => {
      const s = useAppStore.getState();
      if (!s.__init) return;
      setDownloadPath(s.currentFolder);
      setNormalizeName(s.normalizeName);
      setDeleteOld(s.autoRemoveOldFiles);
      setDeleteDuplicate(s.autoRemoveDuplicateFiles);
      setTurboMode(s.turboMode);

      // window.store.get('language').then((lang) => {
      //   if (lang) setLanguage(lang);
      // });
      // window.store.get('link_out_dir').then((dir) => {
      //   if (dir) setLinkOutDir(dir);
      // });
    };
    syncState();
    const unsub = useAppStore.subscribe((s) => {
      if (s.__init) syncState();
    });
    return unsub;
  }, []);

  const restartAppConfirm = useCallback(async () => {
    const warning = await utils.customConfirm(t("setting.restartWarning"), {
      confirmText: t("setting.restartConfirm"),
      cancelText: t("setting.restartCancel"),
      variant: "warning"
    })
    if (!warning) return;
    
    commands.relaunch();
  }, [t]);

  const handleSetDownloadPath = (path: string) => {
    if (!path) {
      path = "C:\\Downloads"
    }
    setDownloadPath(path);
    state.currentFolder = path;
    window.store.set('ipswFolder', path);
  };

  const handleSaveLinkConfig = useCallback(async () => {
    state.normalizeName = normalizeName;
    await Promise.all([
      window.store.set('link_enabled', normalizeName),
      window.store.set('link_out_dir', linkOutDir),
    ]);
    await restartAppConfirm();
  }, [normalizeName, linkOutDir, restartAppConfirm]);

  const handleSetDeleteOld = useCallback(async (value: boolean) => {
    state.autoRemoveOldFiles = value;
    window.store.set('cleanup_remove_old', value);

    await restartAppConfirm();
    setDeleteOld(value);
  }, [restartAppConfirm]);

  const handleSetDeleteDuplicate = useCallback(async (value: boolean) => {
    state.autoRemoveDuplicateFiles = value;
    window.store.set('cleanup_remove_duplicate', value);

    await restartAppConfirm();
    setDeleteDuplicate(value);
  }, [restartAppConfirm]);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    window.store.set('language', lang);
  };

  const handleSetTurboMode = useCallback(async (value: boolean) => {
    if (value) {
      const warning = await utils.customConfirm(t("setting.turboWarning"), {
        title: t("setting.turboWarningTitle"),
        confirmText: t("setting.turboConfirm"),
        cancelText: t("setting.turboCancel"),
        variant: "danger"
      })
      if (!warning) return;
    }

    state.turboMode = value;
    window.store.set('turboMode', value);

    await restartAppConfirm();

    setTurboMode(value);
  }, [restartAppConfirm, t]);

  return (
    <div className="w-full h-full overflow-y-auto bg-[#0d0d0d] text-[#e5e5e5]">
      <main className="w-full px-10! pt-10! pb-16!">

        {/* Page Header */}
        <div className="flex items-start justify-between mb-10!">
          <div>
            <h1 className="text-[22px] font-bold text-[#e5e5e5] tracking-tight">{t('setting.title')}</h1>
          </div>
          <button
            onClick={() => navigate("/")}
            className="w-10 h-10 flex items-center justify-center rounded-lg border border-white/[0.07] bg-[#1e1e1e] text-[#5a6a7a] transition-all duration-150 hover:bg-[#223040] hover:border-white/15 hover:text-[#e8edf2] cursor-pointer shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ABOUT */}
        <Section icon={IconAbout} title={t('setting.about')}>
          <Row
            label={t('app.version.title')}
            right={
              <span className="font-bold text-[12px] text-[#137fec] bg-[#303337] border border-white/[0.07] px-3! py-1! rounded-full tracking-[0.04em]">
                {appVersion} - Premium Edition - VIP
              </span>
            }
          />
          <Row
            label={t('app.developer')}
            right={
              <div className="flex items-center gap-3!">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#137fec] to-[#0d5fb8] flex items-center justify-center text-[14px] font-bold text-white shrink-0">
                  N
                </div>
                <div>
                  <p className="text-[14px] font-medium text-[#e8edf2]">Nguyễn Kim Phúc</p>
                  <p className="text-[12px] text-[#5a6a7a] mt-0.5!">Developer</p>
                </div>
              </div>
            }
          />
        </Section>

        {/* LANGUAGE */}
        <Section icon={IconLanguage} title={t("setting.language")}>
          <Row
            label={t("app.language.label")}
            desc={t("app.language.desc")}
            right={
              <div className="flex gap-2!">
                {(["en", "vi"] as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => handleSetLanguage(lang)}
                    className={[
                      "px-4! py-2! rounded-lg text-[13px] font-medium border transition-all duration-150 cursor-pointer select-none",
                      language === lang
                        ? "bg-[rgba(19,127,236,0.12)] border-[#137fec] text-[#137fec]"
                        : "bg-[#161616] border-white/[0.07] text-[#e8edf2] hover:border-[rgba(19,127,236,0.35)] hover:text-[#e8edf2]",
                    ].join(" ")}
                  >
                    {lang === "en" ? "English" : "Tiếng Việt"}
                  </button>
                ))}
              </div>
            }
          />
        </Section>

        {/* DOWNLOAD */}
        <Section icon={IconDownload} title={t("setting.download")}>
          <PathRow
            label={t("app.download.savePath.label")}
            desc={t("app.download.savePath.desc")}
            value={downloadPath}
            onBrowse={async () => {
              const result = await commands.pickFolder();
              if (result.status === "ok") {
                handleSetDownloadPath(result.data ?? "")
              }
            }}
            onChange={handleSetDownloadPath}
            placeholder="C:\Downloads"
          />
          <Row
            label={t("app.download.turboMode.label")}
            desc={t("app.download.turboMode.desc")}
            right={<Toggle on={turboMode} onChange={handleSetTurboMode} />}
          />
        </Section>

        {/* SOFTWARE */}
        <Section icon={IconSoftware} title={t("setting.firmware")}>
          <Row
            label={t("app.firmware.normalizeName.label")}
            desc={t("app.firmware.normalizeName.desc")}
            right={<Toggle on={normalizeName} onChange={setNormalizeName} />}
          />
          {normalizeName && (
            <div className="flex items-center gap-3! px-6! pb-5! pt-3!">
              <input
                type="text"
                value={linkOutDir}
                onChange={e => setLinkOutDir(e.target.value)}
                placeholder="IPSW_FILES"
                className="flex-1 min-w-0 bg-[#292a2b] border border-white/[0.07] rounded-lg px-3! py-2! text-[13px] font-mono text-[#8a9ab0] outline-none caret-[#137fec] transition-all duration-150 focus:border-[#137fec] focus:text-[#e8edf2] focus:bg-[#223040]"
              />
              <button
                onClick={handleSaveLinkConfig}
                className="px-4! py-2! rounded-lg bg-[#137fec] text-white text-[13px] font-medium border-none cursor-pointer whitespace-nowrap transition-all duration-150 hover:bg-[#1a86d8] shrink-0"
              >
                {t("app.firmware.linkOutDir.save")}
              </button>
            </div>
          )}
          <Row
            label={t("app.autoDeleteOld.label")}
            desc={t("app.autoDeleteOld.desc")}
            right={<Toggle on={deleteOld} onChange={handleSetDeleteOld} />}
          />
          <Row
            label={t("app.autoDeleteDuplicate.label")}
            desc={t("app.autoDeleteDuplicate.desc")}
            right={<Toggle on={deleteDuplicate} onChange={handleSetDeleteDuplicate} />}
          />
        </Section>
      </main>
    </div>
  );
}