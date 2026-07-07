import { useState, useEffect, useCallback, useRef, ReactNode, JSX, memo } from "react";
import { useTranslation } from "react-i18next";
import { state } from "../data";
import "./welcome.css";

const SETTING_VERSION = "2.0.0";
export { SETTING_VERSION };

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}

interface DirPickerProps {
    value: string;
    onChange: (v: string) => void;
    onBrowse?: () => void;
}

interface SettingRowProps {
    icon: ReactNode;
    label: string;
    desc?: string;
    badge?: string;
    children?: ReactNode;
}

interface SectionProps {
    icon: ReactNode;
    title: string;
    accent: string;
    children: ReactNode;
}

interface WhatsNewItem {
    text: string;
    tag?: string;
}

// ─── Icons (SVG) ─────────────────────────────────────────────────────────────

const IcoDownload = memo(() => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
));
const IcoFirmware = memo(() => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M7 7h2v2H7zM11 7h2v2h-2zM15 7h2v2h-2z" />
    </svg>
));
const IcoFolder = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
));
const IcoZap = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
));
const IcoShield = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
));
const IcoFile = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
    </svg>
));
const IcoTrash = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
));
const IcoCopy = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
));
const IcoCheck = memo(() => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
));
const IcoSparkle = memo(() => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
));
const IcoArrow = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
));
const IcoChevronLeft = memo(() => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
    </svg>
));

const Ico = {
    Download: IcoDownload,
    Firmware: IcoFirmware,
    Folder: IcoFolder,
    Zap: IcoZap,
    Shield: IcoShield,
    File: IcoFile,
    Trash: IcoTrash,
    Copy: IcoCopy,
    Check: IcoCheck,
    Sparkle: IcoSparkle,
    Arrow: IcoArrow,
    ChevronLeft: IcoChevronLeft,
};

// ─── Toggle ──────────────────────────────────────────────────────────────────

const Toggle: React.FC<ToggleProps> = memo(({ checked, onChange, disabled = false }) => (
    <button
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={[
            "relative h-7 w-12 rounded-full transition-colors duration-200",
            checked ? "bg-[#0078d4]" : "bg-[#404040]",
            disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        ].join(" ")}
    >
        <span
            className={[
                "absolute left-0.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow",
                "transition-transform duration-200",
                checked ? "translate-x-6" : "translate-x-0",
            ].join(" ")}
        />
    </button>
));

// ─── DirPicker ───────────────────────────────────────────────────────────────

const DirPicker: React.FC<DirPickerProps> = memo(({ value, onChange, onBrowse }) => (
    <div className="mt-2! flex w-full items-center gap-1.5">
        <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-[#1a1a1a] border border-[#3a3a3a] px-2.5! py-1.5! font-mono text-[11.5px] text-[#e8e8e8] empty:text-[#666]">
            {value}
        </div>
        <button
            onClick={onBrowse || (() => onChange(""))}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded border border-[#3a3a3a] bg-[#2d2d2d] px-3! py-1.5! text-[12px] text-[#ccc] transition-colors duration-120 hover:border-[#0078d4] hover:bg-[#383838]"
        >
            <Ico.Folder /> Browse…
        </button>
    </div>
));

// ─── SettingRow ───────────────────────────────────────────────────────────────

const SettingRow: React.FC<SettingRowProps> = memo(({ icon, label, desc, badge, children }) => {
    const isDirPicker = (children as any)?.type === DirPicker;
    return (
        <div className="flex items-start gap-3 border-b border-[#222] px-5! py-3.25! transition-colors duration-100 hover:bg-[#1e1e1e]">
            <div className="mt-px! shrink-0 text-[#666]">{icon}</div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-normal text-[#e8e8e8]">{label}</span>
                    {badge && (
                        <span className="rounded-sm border border-[#0078d440] bg-[#0078d420] px-1.5! py-0.5! text-[9px] font-semibold uppercase tracking-[0.07em] text-[#0078d4]">
                            {badge}
                        </span>
                    )}
                </div>
                {desc && (
                    <div className="mt-0.75! text-[11.5px] leading-[1.45] text-[#666]">{desc}</div>
                )}
                {isDirPicker && <div>{children}</div>}
            </div>
            {!isDirPicker && children && (
                <div className="mt-px! shrink-0">{children}</div>
            )}
        </div>
    );
});

// ─── Section ─────────────────────────────────────────────────────────────────

const Section: React.FC<SectionProps> = memo(({ icon, title, accent, children }) => (
    <div className="mb-3! overflow-hidden rounded-md border border-[#2a2a2a] bg-[#161616]">
        <div className="flex items-center gap-2.5 border-b border-[#2a2a2a] bg-[#1c1c1c] px-5! py-2.5!">
            <div
                className="flex size-6 shrink-0 items-center justify-center rounded-[3px] border"
                style={{
                    background: accent + "20",
                    borderColor: accent + "45",
                    color: accent,
                }}
            >
                {icon}
            </div>
            <span className="text-[12.5px] font-semibold tracking-[0.02em] text-[#c8c8c8]">
                {title}
            </span>
        </div>
        <div>{children}</div>
    </div>
));

// ─── Pages ────────────────────────────────────────────────────────────────────

const PageWelcome: React.FC<{ onNext: () => void }> = ({ onNext }) => {
    const { t } = useTranslation();
    return (
        <div className="flex-1 overflow-y-auto px-9! py-8!">
            {/* Hero */}
            <div className="mb-7! flex items-center gap-4.5">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-[#0078d440] bg-linear-to-br from-[#0a1a30] to-[#0d2040] shadow-[0_0_20px_#0078d420]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0078d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                    </svg>
                </div>
                <div>
                    <h1 className="m-0! font-[\'Segoe_UI_Variable_Display\',\'Segoe_UI\',sans-serif] text-[22px] font-semibold leading-[1.15] tracking-[-0.01em] text-[#f0f0f0]">
                        IPSW Manager
                    </h1>
                    <div className="mt-0.75! text-[12px] text-[#666]">
                        {t('wizard.welcome.version', { version: window.api.getVersion })}
                    </div>
                </div>
            </div>

            {/* Welcome text */}
            <p className="mb-7! max-w-120 text-[13.5px] leading-[1.7] text-[#aaa]">
                {t('wizard.welcome.text', { version: window.api.getVersion })}
            </p>

            {/* What's New */}
            <div className="mb-7! overflow-hidden rounded-md border border-[#f59e0b28] bg-[#f59e0b08]">
                <div className="flex items-center gap-2 border-b border-[#f59e0b20] bg-[#f59e0b10] px-4! py-2.25!">
                    <Ico.Sparkle />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#f59e0b]">
                        {t('wizard.welcome.whatsnew')}
                    </span>
                </div>
                <div className="flex flex-col gap-2 px-4! py-3!">
                    {([
                        { text: t('wizard.welcome.feature1') },
                        { text: t('wizard.welcome.feature2') },
                        { text: t('wizard.welcome.feature3') },
                        { text: t('wizard.welcome.feature4') },
                        { text: t('wizard.welcome.feature5') },
                        { text: t('wizard.welcome.feature6') },
                    ] as WhatsNewItem[]).map((item, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                            <div className="mt-0.5! flex size-4 shrink-0 items-center justify-center rounded-full border border-[#f59e0b40] bg-[#f59e0b20] text-[#f59e0b]">
                                <Ico.Check />
                            </div>
                            <div className="flex-1 text-[12.5px] leading-[1.45] text-[#c0c0c0]">
                                {item.text}
                                {item.tag && (
                                    <span className="ml-1.75! rounded-sm border border-[#333] bg-[#2a2a2a] px-1.25! py-px! text-[9.5px] text-[#888]">
                                        {item.tag}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <button
                onClick={onNext}
                className="flex cursor-pointer items-center gap-2 rounded border-none bg-[#0078d4] px-5.5! py-2.25! font-['Segoe_UI',sans-serif] text-[13px] font-medium text-white shadow-[0_2px_8px_#0078d440] transition-colors duration-120 hover:bg-[#1a86d8]"
            >
                {t('wizard.getStarted')} <Ico.Arrow />
            </button>
        </div>
    );
};

// ─── Download Page ─────────────────────────────────────────────────────────────

interface DownloadPageProps {
    saveDir: string;
    setSaveDir: (v: string) => void;
    onBrowseSaveDir: () => void;
    skipVerify: boolean;
    setSkipVerify: (v: boolean) => void;
    turboMode: boolean;
    setTurboMode: (v: boolean) => void;
    onNext: () => void;
    onBack: () => void;
}

const PageDownload: React.FC<DownloadPageProps> = ({
    saveDir, setSaveDir, onBrowseSaveDir, skipVerify, setSkipVerify, turboMode, setTurboMode, onNext, onBack,
}) => {
    const { t } = useTranslation();
    return (
        <div className="flex-1 overflow-y-auto px-9! py-7!">
            <div className="mb-5.5!">
                <h2 className="m-0! mb-1.25! text-[18px] font-semibold text-[#f0f0f0]">{t('wizard.download.title')}</h2>
                <p className="m-0! text-[12.5px] text-[#666]">{t('wizard.download.subtitle')}</p>
            </div>

            <Section icon={<Ico.Download />} title={t('wizard.download.section.storage')} accent="#0078d4">
                <SettingRow icon={<Ico.Folder />} label={t('wizard.download.saveDir.label')} desc={t('wizard.download.saveDir.desc')}>
                    <DirPicker value={saveDir} onChange={setSaveDir} onBrowse={onBrowseSaveDir} />
                </SettingRow>
            </Section>

            <Section icon={<Ico.Zap />} title={t('wizard.download.section.performance')} accent="#f59e0b">
                <SettingRow
                    icon={<Ico.Zap />}
                    label={t('wizard.download.turbo.label')}
                    badge={t('wizard.badge.new')}
                    desc={t('wizard.download.turbo.desc')}
                >
                    <Toggle checked={turboMode} onChange={setTurboMode} />
                </SettingRow>
            </Section>

            <Section icon={<Ico.Shield />} title={t('wizard.download.section.integrity')} accent="#888">
                <SettingRow
                    icon={<Ico.Shield />}
                    label={t('wizard.download.skipVerify.label')}
                    desc={t('wizard.download.skipVerify.desc')}
                >
                    <Toggle checked={skipVerify} onChange={setSkipVerify} />
                </SettingRow>
            </Section>

            <div className="mt-4! flex justify-between">
                <BtnBack onClick={onBack} label={t('wizard.btn.back')} />
                <BtnNext onClick={onNext} label={t('wizard.download.btn.next')} />
            </div>
        </div>
    );
};

// ─── Firmware Page ─────────────────────────────────────────────────────────────

interface FirmwarePageProps {
    parseFileName: boolean; setParseFileName: (v: boolean) => void;
    linkOutDir: string; setLinkOutDir: (v: string) => void;
    autoRemoveOld: boolean; setAutoRemoveOld: (v: boolean) => void;
    autoRemoveDupe: boolean; setAutoRemoveDupe: (v: boolean) => void;
    autoRemoveInvalid: boolean; setAutoRemoveInvalid: (v: boolean) => void;
    onFinish: () => void;
    onBack: () => void;
}

const PageFirmware: React.FC<FirmwarePageProps> = ({
    parseFileName, setParseFileName,
    linkOutDir, setLinkOutDir,
    autoRemoveOld, setAutoRemoveOld,
    autoRemoveDupe, setAutoRemoveDupe,
    autoRemoveInvalid, setAutoRemoveInvalid,
    onFinish, onBack,
}) => {
    const { t } = useTranslation();
    return (
        <div className="flex-1 overflow-y-auto px-9! py-7!">
            <div className="mb-5.5!">
                <h2 className="m-0! mb-1.25! text-[18px] font-semibold text-[#f0f0f0]">{t('wizard.firmware.title')}</h2>
                <p className="m-0! text-[12.5px] text-[#666]">{t('wizard.firmware.subtitle')}</p>
            </div>

            <Section icon={<Ico.File />} title={t('wizard.firmware.section.parsing')} accent="#0078d4">
                <SettingRow
                    icon={<Ico.File />}
                    label={t('wizard.firmware.parse.label')}
                    badge={t('wizard.badge.new')}
                    desc={t('wizard.firmware.parse.desc')}
                >
                    <Toggle checked={parseFileName} onChange={setParseFileName} />
                </SettingRow>
                {parseFileName && (
                    <div className="border-b border-[#222] pb-4! pl-13! pr-5! pt-2.5!">
                        <div className="mb-1.5! text-[12px] text-[#aaa]">
                            {t('wizard.firmware.linkOutDir.label')}
                        </div>
                        <input
                            type="text"
                            value={linkOutDir}
                            onChange={e => setLinkOutDir(e.target.value)}
                            placeholder="IPSW_FILES"
                            className="w-full rounded border border-[#3a3a3a] bg-[#1a1a1a] px-2.5! py-1.5! font-mono text-[12px] text-[#e8e8e8] outline-none transition-colors focus:border-[#0078d4]"
                        />
                        <div className="mt-1! text-[11px] text-[#666]">
                            {t('wizard.firmware.linkOutDir.desc')}
                        </div>
                    </div>
                )}
            </Section>

            <Section icon={<Ico.Trash />} title={t('wizard.firmware.section.cleanup')} accent="#22c55e">
                <SettingRow
                    icon={<Ico.Trash />}
                    label={t('wizard.firmware.removeOld.label')}
                    badge={t('wizard.badge.new')}
                    desc={t('wizard.firmware.removeOld.desc')}
                >
                    <Toggle checked={autoRemoveOld} onChange={setAutoRemoveOld} />
                </SettingRow>
                <SettingRow
                    icon={<Ico.Copy />}
                    label={t('wizard.firmware.removeDupe.label')}
                    badge={t('wizard.badge.new')}
                    desc={t('wizard.firmware.removeDupe.desc')}
                >
                    <Toggle checked={autoRemoveDupe} onChange={setAutoRemoveDupe} />
                </SettingRow>
                <SettingRow
                    icon={<Ico.Shield />}
                    label={t('wizard.firmware.removeInvalid.label')}
                    badge={t('wizard.badge.new')}
                    desc={t('wizard.firmware.removeInvalid.desc')}
                >
                    <Toggle checked={autoRemoveInvalid} onChange={setAutoRemoveInvalid} />
                </SettingRow>
            </Section>

            <div className="mt-4! flex justify-between">
                <BtnBack onClick={onBack} label={t('wizard.btn.back')} />
                <button
                    onClick={onFinish}
                    className="flex cursor-pointer items-center gap-2 rounded border-none bg-[#0078d4] px-5.5! py-2! text-[13px] font-medium text-white shadow-[0_2px_10px_#0078d440] transition-colors duration-120 hover:bg-[#1a86d8]"
                >
                    {t('wizard.firmware.btn.finish')} <Ico.Check />
                </button>
            </div>
        </div>
    );
};

// ─── Done Screen ──────────────────────────────────────────────────────────────

const PageDone: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10!">
            <div className="flex size-15 animate-[welcome-pop-in_0.25s_var(--ease-decelerate)_both] items-center justify-center rounded-full bg-[#0078d4]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </div>
            <div className="text-center">
                <div className="mb-1.5! text-[18px] font-semibold text-[#f0f0f0]">{t('wizard.done.title')}</div>
                <div className="text-[12.5px] text-[#666]">{t('wizard.done.subtitle')}</div>
            </div>
        </div>
    );
};

// ─── Shared Button Primitives ─────────────────────────────────────────────────

const BtnBack: React.FC<{ onClick: () => void; label: string }> = memo(({ onClick, label }) => (
    <button
        onClick={onClick}
        className="flex cursor-pointer items-center gap-1.5 rounded border border-[#3a3a3a] bg-transparent px-4.5! py-2! text-[13px] font-medium text-[#aaa] transition-all duration-120 hover:border-[#555] hover:bg-[#1e1e1e]"
    >
        <Ico.ChevronLeft /> {label}
    </button>
));

const BtnNext: React.FC<{ onClick: () => void; label: string }> = memo(({ onClick, label }) => (
    <button
        onClick={onClick}
        className="flex cursor-pointer items-center gap-2 rounded border-none bg-[#0078d4] px-5! py-2! text-[13px] font-medium text-white transition-colors duration-120 hover:bg-[#1a86d8]"
    >
        {label} <Ico.Arrow />
    </button>
));

// ─── Root App ─────────────────────────────────────────────────────────────────

type Page = "welcome" | "download" | "firmware" | "done";

const PROGRESS: Record<Page, string> = {
    welcome: "33%",
    download: "66%",
    firmware: "100%",
    done: "100%",
};

export default function App(): JSX.Element {
    const [page, setPage] = useState<Page>("welcome");
    const [saveDir, setSaveDir] = useState<string>("");
    const [skipVerify, setSkipVerify] = useState<boolean>(false);
    const [turboMode, setTurboMode] = useState<boolean>(false);
    const [parseFileName, setParseFileName] = useState<boolean>(true);
    const [linkOutDir, setLinkOutDir] = useState<string>("IPSW_FILES");
    const [autoRemoveOld, setAutoRemoveOld] = useState<boolean>(false);
    const [autoRemoveDupe, setAutoRemoveDupe] = useState<boolean>(false);
    const [autoRemoveInvalid, setAutoRemoveInvalid] = useState<boolean>(true);

    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    useEffect(() => {
        Promise.all([
            window.store.get('ipswFolder'),
            window.store.get('turboMode'),
            window.store.get('skipVerify'),
            window.store.get('link_enabled'),
            window.store.get('link_out_dir'),
            window.store.get('cleanup_remove_old'),
            window.store.get('cleanup_remove_duplicate'),
            window.store.get('cleanup_remove_invalid'),
        ]).then(([savedFolder, savedTurboMode, savedSkipVerify, savedLinkEnabled, savedLinkOutDir, savedCleanOld, savedCleanDupe, savedCleanInvalid]) => {
            if (savedFolder) setSaveDir(savedFolder);
            if (savedTurboMode != null) setTurboMode(savedTurboMode);
            if (savedSkipVerify != null) setSkipVerify(savedSkipVerify);
            if (savedLinkEnabled != null) setParseFileName(savedLinkEnabled);
            if (savedLinkOutDir) setLinkOutDir(savedLinkOutDir);
            if (savedCleanOld != null) setAutoRemoveOld(savedCleanOld);
            if (savedCleanDupe != null) setAutoRemoveDupe(savedCleanDupe);
            if (savedCleanInvalid != null) setAutoRemoveInvalid(savedCleanInvalid);
        });
    }, []);

    const handleBrowseSaveDir = useCallback(async () => {
        const path = await window.api.selectFolder?.();
        if (path) setSaveDir(path);
    }, []);

    const finishSetup = useCallback(async () => {
        state.currentFolder = saveDir;
        state.turboMode = turboMode;
        state.normalizeName = parseFileName;
        state.autoRemoveOldFiles = autoRemoveOld;
        state.autoRemoveDuplicateFiles = autoRemoveDupe;

        await Promise.all([
            window.store.set('ipswFolder', saveDir),
            window.store.set('turboMode', turboMode),
            window.store.set('skipVerify', skipVerify),
            window.store.set('link_enabled', parseFileName),
            window.store.set('link_out_dir', linkOutDir),
            window.store.set('cleanup_remove_old', autoRemoveOld),
            window.store.set('cleanup_remove_duplicate', autoRemoveDupe),
            window.store.set('cleanup_remove_invalid', autoRemoveInvalid),
            window.store.set('settingVersion', SETTING_VERSION),
        ]);

        setPage("done");
        await new Promise(r => setTimeout(r, 1500));
        if (mountedRef.current) window.api.relaunch();
    }, [saveDir, turboMode, skipVerify, parseFileName, linkOutDir, autoRemoveOld, autoRemoveDupe, autoRemoveInvalid]);

     useEffect(() => window.api.ready(), []);

    return (
        <>
            <div className="flex h-screen min-h-140 flex-col overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#111]">
                <div className="flex flex-1 overflow-hidden">
                    <div className="flex flex-1 flex-col overflow-hidden bg-[#111]">
                        <div key={page} className="page-enter flex flex-1 flex-col overflow-y-auto">
                            {page === "welcome" && (
                                <PageWelcome onNext={() => setPage("download")} />
                            )}
                            {page === "download" && (
                                <PageDownload
                                    saveDir={saveDir} setSaveDir={setSaveDir}
                                    onBrowseSaveDir={handleBrowseSaveDir}
                                    skipVerify={skipVerify} setSkipVerify={setSkipVerify}
                                    turboMode={turboMode} setTurboMode={setTurboMode}
                                    onNext={() => setPage("firmware")}
                                    onBack={() => setPage("welcome")}
                                />
                            )}
                            {page === "firmware" && (
                                <PageFirmware
                                    parseFileName={parseFileName} setParseFileName={setParseFileName}
                                    linkOutDir={linkOutDir} setLinkOutDir={setLinkOutDir}
                                    autoRemoveOld={autoRemoveOld} setAutoRemoveOld={setAutoRemoveOld}
                                    autoRemoveDupe={autoRemoveDupe} setAutoRemoveDupe={setAutoRemoveDupe}
                                    autoRemoveInvalid={autoRemoveInvalid} setAutoRemoveInvalid={setAutoRemoveInvalid}
                                    onFinish={finishSetup}
                                    onBack={() => setPage("download")}
                                />
                            )}
                            {page === "done" && <PageDone />}
                        </div>

                        {/* Bottom progress bar */}
                        {page !== "done" && (
                            <div className="h-0.5 shrink-0 bg-[#1e1e1e]">
                                <div
                                    className="h-full bg-[#0078d4] transition-[width] duration-350 ease-in-out"
                                    style={{ width: PROGRESS[page] }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}