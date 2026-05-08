import { useState, useEffect, CSSProperties, ReactNode, JSX } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}

interface DirPickerProps {
    value: string;
    onChange: (v: string) => void;
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

const Ico = {
    Download: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    ),
    Firmware: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
            <path d="M7 7h2v2H7zM11 7h2v2h-2zM15 7h2v2h-2z" />
        </svg>
    ),
    Folder: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    ),
    Zap: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    ),
    Shield: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    ),
    File: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    ),
    Trash: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
    ),
    Copy: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    ),
    Check: () => (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    Sparkle: () => (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
        </svg>
    ),
    Arrow: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
        </svg>
    ),
    MinBtn: () => (
        <svg width="10" height="1" viewBox="0 0 10 1">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
        </svg>
    ),
    MaxBtn: () => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
        </svg>
    ),
    CloseBtn: () => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
    ),
};

// ─── Toggle ──────────────────────────────────────────────────────────────────

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled = false }) => (
    <button
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        style={{
            width: 40, height: 20, borderRadius: 10, border: "none",
            background: checked ? "#0078d4" : "#404040",
            cursor: disabled ? "not-allowed" : "pointer",
            position: "relative",
            transition: "background 0.18s",
            flexShrink: 0,
            opacity: disabled ? 0.38 : 1,
            outline: "none",
        }}
    >
        <span style={{
            position: "absolute", top: 2,
            left: checked ? 22 : 2,
            width: 16, height: 16, borderRadius: "50%",
            background: "#fff",
            transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
            boxShadow: "0 1px 3px rgba(0,0,0,.5)",
        }} />
    </button>
);

// ─── DirPicker ───────────────────────────────────────────────────────────────

const DirPicker: React.FC<DirPickerProps> = ({ value, onChange }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%", marginTop: 8 }}>
        <div style={{
            flex: 1, background: "#1a1a1a", border: "1px solid #3a3a3a",
            borderRadius: 4, padding: "6px 10px",
            fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: 11.5,
            color: value ? "#e8e8e8" : "#666",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            minWidth: 0,
        }}>
            {value || "C:\\Users\\User\\Downloads\\IPSW"}
        </div>
        <button
            onClick={() => onChange(`C:\\Users\\User\\Downloads\\IPSW_${Math.floor(Math.random() * 1000)}`)}
            style={{
                background: "#2d2d2d", border: "1px solid #3a3a3a",
                borderRadius: 4, padding: "6px 12px", color: "#ccc",
                cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 5,
                whiteSpace: "nowrap",
                transition: "background 0.12s, border-color 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#383838"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#0078d4"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#2d2d2d"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#3a3a3a"; }}
        >
            <Ico.Folder /> Browse…
        </button>
    </div>
);

// ─── SettingRow ───────────────────────────────────────────────────────────────

const SettingRow: React.FC<SettingRowProps> = ({ icon, label, desc, badge, children }) => (
    <div style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "13px 20px",
        borderBottom: "1px solid #222",
        transition: "background 0.1s",
    }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "#1e1e1e"}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
    >
        <div style={{ color: "#666", marginTop: 1, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#e8e8e8", fontWeight: 400 }}>{label}</span>
                {badge && (
                    <span style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: "0.07em",
                        padding: "2px 6px", borderRadius: 2,
                        background: "#0078d420", color: "#0078d4",
                        textTransform: "uppercase" as const, border: "1px solid #0078d440",
                    }}>{badge}</span>
                )}
            </div>
            {desc && (
                <div style={{ fontSize: 11.5, color: "#666", marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
            )}
            {/* DirPicker goes below label if it's a wide child */}
            {children && (children as any)?.type === DirPicker && (
                <div>{children}</div>
            )}
        </div>
        {children && (children as any)?.type !== DirPicker && (
            <div style={{ flexShrink: 0, marginTop: 1 }}>{children}</div>
        )}
    </div>
);

// ─── Section ─────────────────────────────────────────────────────────────────

const Section: React.FC<SectionProps> = ({ icon, title, accent, children }) => (
    <div style={{
        borderRadius: 6, overflow: "hidden",
        border: "1px solid #2a2a2a",
        background: "#161616",
        marginBottom: 12,
    }}>
        {/* Section header */}
        <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 20px",
            background: "#1c1c1c",
            borderBottom: "1px solid #2a2a2a",
        }}>
            <div style={{
                width: 24, height: 24, borderRadius: 3,
                background: accent + "20", border: "1px solid " + accent + "45",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: accent,
            }}>{icon}</div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#c8c8c8", letterSpacing: "0.02em" }}>
                {title}
            </span>
        </div>
        <div>{children}</div>
    </div>
);

// ─── Nav Sidebar ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
    { id: "welcome", label: "Welcome", icon: <Ico.Sparkle /> },
    { id: "download", label: "Download", icon: <Ico.Download /> },
    { id: "firmware", label: "Firmware", icon: <Ico.Firmware /> },
];

interface NavItemProps {
    id: string;
    label: string;
    icon: ReactNode;
    active: boolean;
    done: boolean;
    locked: boolean;
    onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ label, icon, active, done, locked, onClick }) => (
    <button
        onClick={onClick}
        disabled={locked}
        title={locked ? "Complete the previous step first" : undefined}
        style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px", borderRadius: 5, border: "none",
            background: active ? "#0078d418" : "transparent",
            color: locked ? "#383838" : active ? "#60a8f0" : done ? "#8a8a8a" : "#6a6a6a",
            cursor: locked ? "not-allowed" : "pointer", textAlign: "left" as const,
            fontSize: 12.5,
            transition: "background 0.12s, color 0.12s",
            borderLeft: active ? "2px solid #0078d4" : "2px solid transparent",
            opacity: locked ? 0.45 : 1,
        }}
        onMouseEnter={e => { if (!active && !locked) (e.currentTarget as HTMLButtonElement).style.background = "#1e1e1e"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = active ? "#0078d418" : "transparent"; }}
    >
        <span style={{ flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {done && !active && (
            <span style={{
                width: 16, height: 16, borderRadius: "50%",
                background: "#0078d4", display: "flex", alignItems: "center",
                justifyContent: "center", color: "#fff", flexShrink: 0,
            }}><Ico.Check /></span>
        )}
        {locked && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
        )}
    </button>
);

// ─── Pages ────────────────────────────────────────────────────────────────────

const PageWelcome: React.FC<{ onNext: () => void }> = ({ onNext }) => (
    <div style={{ padding: "32px 36px", flex: 1, overflowY: "auto" }}>
        {/* Hero */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
            <div style={{
                width: 56, height: 56, borderRadius: 8,
                background: "linear-gradient(135deg, #0a1a30 0%, #0d2040 100%)",
                border: "1px solid #0078d440",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 20px #0078d420",
                flexShrink: 0,
            }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0078d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                </svg>
            </div>
            <div>
                <h1 style={{
                    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
                    fontSize: 22, fontWeight: 600, color: "#f0f0f0",
                    letterSpacing: "-0.01em", margin: 0, lineHeight: 1.15,
                }}>
                    IPSW Manager
                </h1>
                <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>
                    Version 4.0.0 · Setup Wizard
                </div>
            </div>
        </div>

        {/* Welcome text */}
        <p style={{ fontSize: 13.5, color: "#aaa", lineHeight: 1.7, marginBottom: 28, maxWidth: 480 }}>
            Welcome to IPSW Manager 4.0. This wizard will guide you through
            the initial configuration. You can change any of these settings
            later from the app's Settings page.
        </p>

        {/* What's New */}
        <div style={{
            borderRadius: 6, overflow: "hidden",
            border: "1px solid #f59e0b28",
            background: "#f59e0b08",
            marginBottom: 28,
        }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 16px",
                background: "#f59e0b10", borderBottom: "1px solid #f59e0b20",
            }}>
                <Ico.Sparkle />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase" as const }}>
                    What's New in 4.0
                </span>
            </div>
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                {([
                    { text: "Parallel chunk downloader with resume support — up to 16 threads", tag: "Download" },
                    { text: "SSD-aware I/O scheduling and direct offset-based chunk merging", tag: "Download" },
                    { text: "Parse firmware file names — extract device, version & build info", tag: "Firmware" },
                    { text: "Auto-cleanup: remove duplicate, outdated and corrupted firmware files", tag: "Firmware" },
                ] as WhatsNewItem[]).map((item, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{
                            marginTop: 2, width: 16, height: 16, borderRadius: "50%",
                            background: "#f59e0b20", border: "1px solid #f59e0b40",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#f59e0b", flexShrink: 0,
                        }}><Ico.Check /></div>
                        <div style={{ fontSize: 12.5, color: "#c0c0c0", lineHeight: 1.45, flex: 1 }}>
                            {item.text}
                            {item.tag && (
                                <span style={{
                                    marginLeft: 7, fontSize: 9.5, color: "#888",
                                    background: "#2a2a2a", borderRadius: 2, padding: "1px 5px",
                                    border: "1px solid #333",
                                }}>{item.tag}</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>

        <button
            onClick={onNext}
            style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 22px", borderRadius: 4,
                background: "#0078d4", border: "none",
                color: "#fff", cursor: "pointer",
                fontSize: 13, fontWeight: 500,
                fontFamily: "'Segoe UI', sans-serif",
                transition: "background 0.12s",
                boxShadow: "0 2px 8px #0078d440",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#1a86d8"}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#0078d4"}
        >
            Get Started <Ico.Arrow />
        </button>
    </div>
);

interface DownloadPageProps {
    saveDir: string;
    setSaveDir: (v: string) => void;
    skipVerify: boolean;
    setSkipVerify: (v: boolean) => void;
    turboMode: boolean;
    setTurboMode: (v: boolean) => void;
    onNext: () => void;
}

const PageDownload: React.FC<DownloadPageProps> = ({
    saveDir, setSaveDir, skipVerify, setSkipVerify, turboMode, setTurboMode, onNext,
}) => (
    <div style={{ padding: "28px 36px", flex: 1, overflowY: "auto" }}>
        <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0", margin: 0, marginBottom: 5 }}>Download Settings</h2>
            <p style={{ fontSize: 12.5, color: "#666", margin: 0 }}>Configure how IPSW files are downloaded and stored.</p>
        </div>

        <Section icon={<Ico.Download />} title="Storage" accent="#0078d4">
            <SettingRow icon={<Ico.Folder />} label="Save Directory" desc="Destination folder for all downloaded IPSW files">
                <DirPicker value={saveDir} onChange={setSaveDir} />
            </SettingRow>
        </Section>

        <Section icon={<Ico.Zap />} title="Performance" accent="#f59e0b">
            <SettingRow
                icon={<Ico.Zap />}
                label="Turbo Mode"
                badge="new"
                desc="Maximize parallel download chunks (up to 16). Recommended for 100Mbps+ connections."
            >
                <Toggle checked={turboMode} onChange={setTurboMode} />
            </SettingRow>
        </Section>

        <Section icon={<Ico.Shield />} title="Integrity" accent="#888">
            <SettingRow
                icon={<Ico.Shield />}
                label="Skip Verification"
                desc="Bypass SHA-256 checksum check after download completes. Not recommended."
            >
                <Toggle checked={skipVerify} onChange={setSkipVerify} />
            </SettingRow>
        </Section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
                onClick={onNext}
                style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 20px", borderRadius: 4,
                    background: "#0078d4", border: "none",
                    color: "#fff", cursor: "pointer",
                    fontSize: 13, fontWeight: 500, transition: "background 0.12s",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#1a86d8"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#0078d4"}
            >
                Next: Firmware <Ico.Arrow />
            </button>
        </div>
    </div>
);

interface FirmwarePageProps {
    parseFileName: boolean; setParseFileName: (v: boolean) => void;
    autoRemoveOld: boolean; setAutoRemoveOld: (v: boolean) => void;
    autoRemoveDupe: boolean; setAutoRemoveDupe: (v: boolean) => void;
    autoRemoveInvalid: boolean; setAutoRemoveInvalid: (v: boolean) => void;
    onFinish: () => void;
}

const PageFirmware: React.FC<FirmwarePageProps> = ({
    parseFileName, setParseFileName,
    autoRemoveOld, setAutoRemoveOld,
    autoRemoveDupe, setAutoRemoveDupe,
    autoRemoveInvalid, setAutoRemoveInvalid,
    onFinish,
}) => (
    <div style={{ padding: "28px 36px", flex: 1, overflowY: "auto" }}>
        <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0", margin: 0, marginBottom: 5 }}>Firmware Settings</h2>
            <p style={{ fontSize: 12.5, color: "#666", margin: 0 }}>Manage how firmware files are parsed and maintained.</p>
        </div>

        <Section icon={<Ico.File />} title="Parsing" accent="#0078d4">
            <SettingRow
                icon={<Ico.File />}
                label="Parse File Name"
                badge="new"
                desc="Extract device model, iOS version and build identifier from IPSW filenames automatically."
            >
                <Toggle checked={parseFileName} onChange={setParseFileName} />
            </SettingRow>
        </Section>

        <Section icon={<Ico.Trash />} title="Auto Cleanup" accent="#22c55e">
            <SettingRow
                icon={<Ico.Trash />}
                label="Auto Remove Old Firmware"
                badge="new"
                desc="Keep only the latest build per device. Older versions will be removed on startup."
            >
                <Toggle checked={autoRemoveOld} onChange={setAutoRemoveOld} />
            </SettingRow>
            <SettingRow
                icon={<Ico.Copy />}
                label="Auto Remove Duplicate Firmware"
                badge="new"
                desc="Find and remove duplicate IPSW files using SHA-256 hash comparison."
            >
                <Toggle checked={autoRemoveDupe} onChange={setAutoRemoveDupe} />
            </SettingRow>
            <SettingRow
                icon={<Ico.Shield />}
                label="Auto Remove Invalid Firmware"
                badge="new"
                desc="Delete corrupted or incomplete IPSW files detected during startup scan."
            >
                <Toggle checked={autoRemoveInvalid} onChange={setAutoRemoveInvalid} />
            </SettingRow>
        </Section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
                onClick={onFinish}
                style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 22px", borderRadius: 4,
                    background: "#0078d4", border: "none",
                    color: "#fff", cursor: "pointer",
                    fontSize: 13, fontWeight: 500, transition: "background 0.12s",
                    boxShadow: "0 2px 10px #0078d440",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#1a86d8"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#0078d4"}
            >
                Finish Setup <Ico.Check />
            </button>
        </div>
    </div>
);

// ─── Done Screen ──────────────────────────────────────────────────────────────

const PageDone: React.FC = () => (
    <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        padding: 40,
    }}>
        <div style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "#0078d4",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "popIn 0.4s cubic-bezier(.34,1.56,.64,1) both",
        }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        </div>
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0", marginBottom: 6 }}>All set!</div>
            <div style={{ fontSize: 12.5, color: "#666" }}>Launching IPSW Manager…</div>
        </div>
    </div>
);

// ─── Root App ─────────────────────────────────────────────────────────────────

type Page = "welcome" | "download" | "firmware" | "done";
const PAGE_ORDER: Page[] = ["welcome", "download", "firmware", "done"];

export default function App(): JSX.Element {
    const [page, setPage] = useState<Page>("welcome");
    // Track the furthest page ever visited — never goes backwards
    const [maxReached, setMaxReached] = useState<number>(0);

    const [saveDir, setSaveDir] = useState<string>("");
    const [skipVerify, setSkipVerify] = useState<boolean>(false);
    const [turboMode, setTurboMode] = useState<boolean>(false);
    const [parseFileName, setParseFileName] = useState<boolean>(true);
    const [autoRemoveOld, setAutoRemoveOld] = useState<boolean>(false);
    const [autoRemoveDupe, setAutoRemoveDupe] = useState<boolean>(false);
    const [autoRemoveInvalid, setAutoRemoveInvalid] = useState<boolean>(true);

    const navigate = (target: Page) => {
        const idx = PAGE_ORDER.indexOf(target);
        setPage(target);
        setMaxReached(prev => Math.max(prev, idx));
    };

    // A nav item is clickable if its index <= maxReached + 1
    // (can always go back, and can go one step ahead if unlocked)
    const isUnlocked = (id: string): boolean => {
        const idx = PAGE_ORDER.indexOf(id as Page);
        return idx <= maxReached + 1;
    };

    const activeNav = page === "done" ? "firmware" : page;
    // "done" checkmark: page has been visited (index <= maxReached)
    const isDone = (id: string): boolean => {
        const idx = PAGE_ORDER.indexOf(id as Page);
        return idx < maxReached || (idx <= maxReached && page !== id);
    };

    const css = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; background: #111; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #e0e0e0; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
    ::-webkit-scrollbar-thumb:hover { background: #383838; }
    @keyframes popIn {
      0% { transform: scale(0); opacity: 0; }
      70% { transform: scale(1.15); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes fadeSlide {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page-enter { animation: fadeSlide 0.22s ease both; }
  `;

    return (
        <>
            <style>{css}</style>
            {/* Window chrome */}
            <div style={{
                display: "flex", flexDirection: "column",
                height: "100vh", minHeight: 560,
                background: "#111",
                border: "1px solid #2a2a2a",
                overflow: "hidden",
                borderRadius: 8,
            }}>
                {/* Body */}
                <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                    {/* Main content */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#111" }}>
                        <div key={page} className="page-enter" style={{ display: "flex", flex: 1, flexDirection: "column", overflowY: "auto" }}>
                            {page === "welcome" && <PageWelcome onNext={() => navigate("download")} />}
                            {page === "download" && (
                                <PageDownload
                                    saveDir={saveDir} setSaveDir={setSaveDir}
                                    skipVerify={skipVerify} setSkipVerify={setSkipVerify}
                                    turboMode={turboMode} setTurboMode={setTurboMode}
                                    onNext={() => navigate("firmware")}
                                />
                            )}
                            {page === "firmware" && (
                                <PageFirmware
                                    parseFileName={parseFileName} setParseFileName={setParseFileName}
                                    autoRemoveOld={autoRemoveOld} setAutoRemoveOld={setAutoRemoveOld}
                                    autoRemoveDupe={autoRemoveDupe} setAutoRemoveDupe={setAutoRemoveDupe}
                                    autoRemoveInvalid={autoRemoveInvalid} setAutoRemoveInvalid={setAutoRemoveInvalid}
                                    onFinish={() => navigate("done")}
                                />
                            )}
                            {page === "done" && <PageDone />}
                        </div>

                        {/* Bottom progress bar */}
                        {page !== "done" && (
                            <div style={{ height: 2, background: "#1e1e1e", flexShrink: 0 }}>
                                <div style={{
                                    height: "100%",
                                    width: page === "welcome" ? "33%" : page === "download" ? "66%" : "100%",
                                    background: "#0078d4",
                                    transition: "width 0.35s cubic-bezier(.4,0,.2,1)",
                                }} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}