import {
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
  type FC,
  type JSX,
} from "react";
import { useTranslation } from "react-i18next";
import { state } from "@/data";
import { Section } from "@/ui/pages/Settings/Section";
import { Row } from "@/ui/pages/Settings/Row";
import { PathRow } from "@/ui/pages/Settings/PathRow";
import { Toggle } from "@/ui/pages/Settings/Toggle";
import {
  IconDownload,
  IconSoftware,
  IconShield,
} from "@/ui/pages/Settings/icons";
import type { DownloadManagerOptions } from "@custom-type/downloader";
import { downloader } from "@/services/downloader";
import "./welcome.css";
import { app, store, dialog } from "@/services/api";

const SETTING_VERSION = "2.0.0";
export { SETTING_VERSION };

// ─── Welcome-specific Icons ──────────────────────────────────────────────────

const IconSparkle: FC = memo(() => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
  </svg>
));

const IconCheck: FC = memo(() => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
));

const IconArrow: FC = memo(() => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
));

const IconChevronLeft: FC = memo(() => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
));

const IconTrash: FC = memo(() => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
));

// ─── Pages ────────────────────────────────────────────────────────────────────

const PageWelcome: FC<{ onNext: () => void }> = ({ onNext }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto px-9! py-8!">
      <div className="mb-7! flex items-center gap-4.5">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-[#0066cc]/25 bg-[#0066cc]/10">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0066cc"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div>
          <h1 className="m-0! text-[22px] font-semibold leading-[1.15] tracking-[-0.022em] text-white">
            IPSW Manager
          </h1>
          <div className="mt-0.75! text-[12px] text-[#666]">
            {t("wizard.welcome.version", { version: app.version })}
          </div>
        </div>
      </div>

      <p className="mb-7! max-w-120 text-[13.5px] leading-[1.7] text-[#cccccc]">
        {t("wizard.welcome.text", { version: app.version })}
      </p>

      <div className="mb-7! overflow-hidden rounded-md border border-[#f59e0b28] bg-[#f59e0b08]">
        <div className="flex items-center gap-2 border-b border-[#f59e0b20] bg-[#f59e0b10] px-4! py-2.25!">
          <IconSparkle />
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#f59e0b]">
            {t("wizard.welcome.whatsnew")}
          </span>
        </div>
        <div className="flex flex-col gap-2 px-4! py-3!">
          {[
            t("wizard.welcome.feature1"),
            t("wizard.welcome.feature2"),
            t("wizard.welcome.feature3"),
            t("wizard.welcome.feature4"),
            t("wizard.welcome.feature5"),
            t("wizard.welcome.feature6"),
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="mt-0.5! flex size-4 shrink-0 items-center justify-center rounded-full border border-[#f59e0b40] bg-[#f59e0b20] text-[#f59e0b]">
                <IconCheck />
              </div>
              <div className="flex-1 text-[12.5px] leading-[1.45] text-[#c0c0c0]">
                {text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onNext}
        className="flex cursor-pointer items-center gap-2 rounded-full border-none bg-[#0066cc] px-5.5! py-2.25! text-[13px] font-medium text-white transition-colors duration-120 hover:bg-[#0071e3]"
      >
        {t("wizard.getStarted")} <IconArrow />
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
  onNext: () => void;
  onBack: () => void;
}

const PageDownload: FC<DownloadPageProps> = ({
  saveDir,
  setSaveDir,
  onBrowseSaveDir,
  skipVerify,
  setSkipVerify,
  onNext,
  onBack,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto px-9! py-7!">
      <div className="mb-5.5!">
        <h2 className="m-0! mb-1.25! text-[18px] font-semibold text-[#f0f0f0]">
          {t("wizard.download.title")}
        </h2>
        <p className="m-0! text-[12.5px] text-[#666]">
          {t("wizard.download.subtitle")}
        </p>
      </div>

      <Section icon={IconDownload} title={t("wizard.download.section.storage")}>
        <PathRow
          label={t("wizard.download.saveDir.label")}
          desc={t("wizard.download.saveDir.desc")}
          value={saveDir}
          onChange={setSaveDir}
          onBrowse={onBrowseSaveDir}
        />
      </Section>

      <Section icon={IconShield} title={t("wizard.download.section.integrity")}>
        <Row
          label={t("wizard.download.skipVerify.label")}
          desc={t("wizard.download.skipVerify.desc")}
          right={<Toggle on={skipVerify} onChange={setSkipVerify} />}
        />
      </Section>

      <div className="mt-4! flex justify-between">
        <BtnBack onClick={onBack} label={t("wizard.btn.back")} />
        <BtnNext onClick={onNext} label={t("wizard.download.btn.next")} />
      </div>
    </div>
  );
};

// ─── Firmware Page ─────────────────────────────────────────────────────────────

interface FirmwarePageProps {
  parseFileName: boolean;
  setParseFileName: (v: boolean) => void;
  linkOutDir: string;
  setLinkOutDir: (v: string) => void;
  autoRemoveOld: boolean;
  setAutoRemoveOld: (v: boolean) => void;
  autoRemoveDupe: boolean;
  setAutoRemoveDupe: (v: boolean) => void;
  autoRemoveInvalid: boolean;
  setAutoRemoveInvalid: (v: boolean) => void;
  onFinish: () => void;
  onBack: () => void;
}

const PageFirmware: FC<FirmwarePageProps> = ({
  parseFileName,
  setParseFileName,
  linkOutDir,
  setLinkOutDir,
  autoRemoveOld,
  setAutoRemoveOld,
  autoRemoveDupe,
  setAutoRemoveDupe,
  autoRemoveInvalid,
  setAutoRemoveInvalid,
  onFinish,
  onBack,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto px-9! py-7!">
      <div className="mb-5.5!">
        <h2 className="m-0! mb-1.25! text-[18px] font-semibold text-[#f0f0f0]">
          {t("wizard.firmware.title")}
        </h2>
        <p className="m-0! text-[12.5px] text-[#666]">
          {t("wizard.firmware.subtitle")}
        </p>
      </div>

      <Section icon={IconSoftware} title={t("wizard.firmware.section.parsing")}>
        <Row
          label={t("wizard.firmware.parse.label")}
          desc={t("wizard.firmware.parse.desc")}
          right={<Toggle on={parseFileName} onChange={setParseFileName} />}
        />
        {parseFileName && (
          <div className="px-6! pb-5! pt-3!">
            <div className="mb-1.5! text-[12px] text-[#aaa]">
              {t("wizard.firmware.linkOutDir.label")}
            </div>
            <input
              type="text"
              value={linkOutDir}
              onChange={(e) => setLinkOutDir(e.target.value)}
              placeholder="IPSW_FILES"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3! py-2! text-[13px] font-mono text-[#7a7a7a] outline-none caret-[#0066cc] transition-all duration-150 focus:border-[#0066cc] focus:text-white focus:bg-white/[0.06]"
            />
            <div className="mt-1! text-[11px] text-[#666]">
              {t("wizard.firmware.linkOutDir.desc")}
            </div>
          </div>
        )}
      </Section>

      <Section icon={IconTrash} title={t("wizard.firmware.section.cleanup")}>
        <Row
          label={t("wizard.firmware.removeOld.label")}
          desc={t("wizard.firmware.removeOld.desc")}
          right={<Toggle on={autoRemoveOld} onChange={setAutoRemoveOld} />}
        />
        <Row
          label={t("wizard.firmware.removeDupe.label")}
          desc={t("wizard.firmware.removeDupe.desc")}
          right={<Toggle on={autoRemoveDupe} onChange={setAutoRemoveDupe} />}
        />
        <Row
          label={t("wizard.firmware.removeInvalid.label")}
          desc={t("wizard.firmware.removeInvalid.desc")}
          right={
            <Toggle on={autoRemoveInvalid} onChange={setAutoRemoveInvalid} />
          }
        />
      </Section>

      <div className="mt-4! flex justify-between">
        <BtnBack onClick={onBack} label={t("wizard.btn.back")} />
        <button
          onClick={onFinish}
          className="flex cursor-pointer items-center gap-2 rounded-full border-none bg-[#0066cc] px-5.5! py-2! text-[13px] font-medium text-white transition-colors duration-120 hover:bg-[#0071e3]"
        >
          {t("wizard.firmware.btn.finish")} <IconCheck />
        </button>
      </div>
    </div>
  );
};

// ─── Done Screen ──────────────────────────────────────────────────────────────

const PageDone: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10!">
      <div className="flex size-15 animate-[welcome-pop-in_0.25s_var(--ease-decelerate)_both] items-center justify-center rounded-full bg-[#34c759]">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="text-center">
        <div className="mb-1.5! text-[18px] font-semibold text-white">
          {t("wizard.done.title")}
        </div>
        <div className="text-[12.5px] text-[#7a7a7a]">
          {t("wizard.done.subtitle")}
        </div>
      </div>
    </div>
  );
};

// ─── Shared Button Primitives ─────────────────────────────────────────────────

const BtnBack: FC<{ onClick: () => void; label: string }> = memo(
  ({ onClick, label }) => (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.06] bg-transparent px-4.5! py-2! text-[13px] font-medium text-[#cccccc] transition-all duration-120 hover:border-white/[0.1] hover:bg-white/[0.04]"
    >
      <IconChevronLeft /> {label}
    </button>
  ),
);

const BtnNext: FC<{ onClick: () => void; label: string }> = memo(
  ({ onClick, label }) => (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-full border-none bg-[#0066cc] px-5! py-2! text-[13px] font-medium text-white transition-colors duration-120 hover:bg-[#0071e3]"
    >
      {label} <IconArrow />
    </button>
  ),
);

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
  const [parseFileName, setParseFileName] = useState<boolean>(true);
  const [linkOutDir, setLinkOutDir] = useState<string>("IPSW_FILES");
  const [autoRemoveOld, setAutoRemoveOld] = useState<boolean>(false);
  const [autoRemoveDupe, setAutoRemoveDupe] = useState<boolean>(false);
  const [autoRemoveInvalid, setAutoRemoveInvalid] = useState<boolean>(true);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    Promise.all([
      store.get("ipswFolder"),
      store.get("skipVerify"),
      store.get("link_enabled"),
      store.get("link_out_dir"),
      store.get("cleanup_remove_old"),
      store.get("cleanup_remove_duplicate"),
      store.get("cleanup_remove_invalid"),
    ]).then(
      ([
        savedFolder,
        savedSkipVerify,
        savedLinkEnabled,
        savedLinkOutDir,
        savedCleanOld,
        savedCleanDupe,
        savedCleanInvalid,
      ]) => {
        if (savedFolder) setSaveDir(savedFolder);
        if (savedSkipVerify != null) setSkipVerify(savedSkipVerify);
        if (savedLinkEnabled != null) setParseFileName(savedLinkEnabled);
        if (savedLinkOutDir) setLinkOutDir(savedLinkOutDir);
        if (savedCleanOld != null) setAutoRemoveOld(savedCleanOld);
        if (savedCleanDupe != null) setAutoRemoveDupe(savedCleanDupe);
        if (savedCleanInvalid != null) setAutoRemoveInvalid(savedCleanInvalid);
      },
    );

    downloader
      .getConfig()
      .then((cfg) => {
        if (cfg.paths?.saveDir) setSaveDir(cfg.paths.saveDir);
        if (cfg.integrity?.enable !== undefined)
          setSkipVerify(!cfg.integrity.enable);
      })
      .catch(() => {});
  }, []);

  const handleBrowseSaveDir = useCallback(async () => {
    const path = await dialog.selectFolder();
    if (path) setSaveDir(path);
  }, []);

  const finishSetup = useCallback(async () => {
    state.currentFolder = saveDir;
    state.normalizeName = parseFileName;
    state.autoRemoveOldFiles = autoRemoveOld;
    state.autoRemoveDuplicateFiles = autoRemoveDupe;

    await Promise.all([
      store.set("ipswFolder", saveDir),
      store.set("skipVerify", skipVerify),
      store.set("link_enabled", parseFileName),
      store.set("link_out_dir", linkOutDir),
      store.set("cleanup_remove_old", autoRemoveOld),
      store.set("cleanup_remove_duplicate", autoRemoveDupe),
      store.set("cleanup_remove_invalid", autoRemoveInvalid),
      store.set("settingVersion", SETTING_VERSION),
      downloader.setConfig({
        paths: { saveDir, stateDir: "", useTmp: true },
        integrity: { enable: !skipVerify, algorithm: "SHA256" },
      } as DownloadManagerOptions),
    ]);

    setPage("done");
    await new Promise((r) => setTimeout(r, 1500));
    if (mountedRef.current) app.relaunch();
  }, [
    saveDir,
    skipVerify,
    parseFileName,
    linkOutDir,
    autoRemoveOld,
    autoRemoveDupe,
    autoRemoveInvalid,
  ]);

  useEffect(() => app.ready(), []);

  return (
    <>
      <div className="flex h-screen min-h-140 flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[#272729]">
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden bg-[#272729]">
            <div
              key={page}
              className="page-enter flex flex-1 flex-col overflow-y-auto"
            >
              {page === "welcome" && (
                <PageWelcome onNext={() => setPage("download")} />
              )}
              {page === "download" && (
                <PageDownload
                  saveDir={saveDir}
                  setSaveDir={setSaveDir}
                  onBrowseSaveDir={handleBrowseSaveDir}
                  skipVerify={skipVerify}
                  setSkipVerify={setSkipVerify}
                  onNext={() => setPage("firmware")}
                  onBack={() => setPage("welcome")}
                />
              )}
              {page === "firmware" && (
                <PageFirmware
                  parseFileName={parseFileName}
                  setParseFileName={setParseFileName}
                  linkOutDir={linkOutDir}
                  setLinkOutDir={setLinkOutDir}
                  autoRemoveOld={autoRemoveOld}
                  setAutoRemoveOld={setAutoRemoveOld}
                  autoRemoveDupe={autoRemoveDupe}
                  setAutoRemoveDupe={setAutoRemoveDupe}
                  autoRemoveInvalid={autoRemoveInvalid}
                  setAutoRemoveInvalid={setAutoRemoveInvalid}
                  onFinish={finishSetup}
                  onBack={() => setPage("download")}
                />
              )}
              {page === "done" && <PageDone />}
            </div>

            {page !== "done" && (
              <div className="h-0.5 shrink-0 bg-white/[0.06]">
                <div
                  className="h-full bg-[#0066cc] transition-[width] duration-350 ease-in-out"
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
