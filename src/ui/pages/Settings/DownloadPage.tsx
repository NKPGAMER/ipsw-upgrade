import { useState, useEffect, useCallback, type FC } from "react";
import { useTranslation } from "react-i18next";
import { state } from "@/data";
import { useAppStore } from "@/stores/app-store";
import { Section } from "./Section";
import { Row } from "./Row";
import { PathRow } from "./PathRow";
import { Toggle } from "./Toggle";
import { Select } from "./Select";
import { IconDownload, IconNetwork, IconZap, IconShield, IconRefresh } from "./icons";
import type { DownloadManagerOptions } from "@custom-type/downloader";
import { downloader } from "@/core/downloader";

type PartialConfig = Partial<{
  [K in keyof DownloadManagerOptions]: DownloadManagerOptions[K] extends object
    ? Partial<DownloadManagerOptions[K]>
    : DownloadManagerOptions[K];
}>;

const DownloadPage: FC = () => {
  const { t } = useTranslation();
  const [downloadPath, setDownloadPath] = useState<string>("C:\\Downloads");
  const [useTmp, setUseTmp] = useState<boolean>(true);
  const [maxConnections, setMaxConnections] = useState<number>(8);
  const [bandwidthLimit, setBandwidthLimit] = useState<number>(0);
  const [performance, setPerformance] = useState<"normal" | "high">("normal");
  const [integrityEnabled, setIntegrityEnabled] = useState<boolean>(true);
  const [integrityAlgo, setIntegrityAlgo] = useState<"MD5" | "SHA1" | "SHA256">("SHA256");
  const [autoResume, setAutoResume] = useState<boolean>(true);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const syncState = () => {
      const s = useAppStore.getState();
      if (!s.__init) return;
      setDownloadPath(s.currentFolder);
    };
    syncState();
    const unsub = useAppStore.subscribe((s) => {
      if (s.__init) syncState();
    });
    return unsub;
  }, []);

  useEffect(() => {
    downloader.getConfig().then((cfg) => {
      setUseTmp(cfg.paths.useTmp ?? true);
      setMaxConnections(cfg.network?.maxConnections ?? 8);
      setBandwidthLimit(cfg.network?.bandwidthLimit ?? 0);
      setPerformance(cfg.download?.performance ?? "normal");
      setIntegrityEnabled(cfg.integrity?.enable ?? true);
      setIntegrityAlgo(cfg.integrity?.algorithm ?? "SHA256");
      setAutoResume(cfg.recovery?.autoResume ?? true);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const saveConfig = useCallback(async (partial: PartialConfig) => {
    await downloader.setConfig(partial as DownloadManagerOptions);
  }, []);

  const handleSetDownloadPath = (path: string) => {
    if (!path) path = "C:\\Downloads";
    setDownloadPath(path);
    state.currentFolder = path;
    window.store.set("ipswFolder", path);
    saveConfig({ paths: { saveDir: path, stateDir: "" } });
  };

  const handleSetUseTmp = (val: boolean) => {
    setUseTmp(val);
    saveConfig({ paths: { saveDir: downloadPath, stateDir: "", useTmp: val } });
  };

  const handleSetMaxConnections = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) return;
    setMaxConnections(num);
    saveConfig({ network: { maxConnections: num, bandwidthLimit } });
  };

  const handleSetBandwidthLimit = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) return;
    setBandwidthLimit(num);
    saveConfig({ network: { maxConnections, bandwidthLimit: num } });
  };

  const handleSetPerformance = (val: string) => {
    const perf = val as "normal" | "high";
    setPerformance(perf);
    saveConfig({ download: { performance: perf } });
  };

  const handleSetIntegrityEnabled = (val: boolean) => {
    setIntegrityEnabled(val);
    saveConfig({ integrity: { enable: val, algorithm: integrityAlgo } });
  };

  const handleSetIntegrityAlgo = (val: string) => {
    const algo = val as "MD5" | "SHA1" | "SHA256";
    setIntegrityAlgo(algo);
    saveConfig({ integrity: { enable: integrityEnabled, algorithm: algo } });
  };

  const handleSetAutoResume = (val: boolean) => {
    setAutoResume(val);
    saveConfig({ recovery: { autoResume: val } });
  };

  if (!loaded) return null;

  return (
    <>
      {/* Save Directory */}
      <Section icon={IconDownload} title={t("setting.download")}>
        <PathRow
          label={t("app.download.savePath.label")}
          desc={t("app.download.savePath.desc")}
          value={downloadPath}
          onBrowse={async () => {
            const path = await window.api.selectFolder?.();
            if (path) handleSetDownloadPath(path);
          }}
          onChange={handleSetDownloadPath}
          placeholder="C:\Downloads"
        />
        <Row
          label={t("setting.download.useTmp.label")}
          desc={t("setting.download.useTmp.desc")}
          right={<Toggle on={useTmp} onChange={handleSetUseTmp} />}
        />
      </Section>

      {/* Network */}
      <Section icon={IconNetwork} title={t("setting.download.network")}>
        <Row
          label={t("setting.download.maxConnections.label")}
          desc={t("setting.download.maxConnections.desc")}
          right={
            <input
              type="number"
              min={1}
              max={32}
              value={maxConnections}
              onChange={e => handleSetMaxConnections(e.target.value)}
              className="w-20 bg-white/4 border border-white/6 rounded-lg px-3! py-2! text-[13px] text-[#e8edf2] text-center outline-none caret-apple-primary transition-all duration-150 focus:border-apple-primary focus:bg-white/6"
            />
          }
        />
        <Row
          label={t("setting.download.bandwidthLimit.label")}
          desc={t("setting.download.bandwidthLimit.desc")}
          right={
            <div className="flex items-center gap-2!">
              <input
                type="number"
                min={0}
                value={bandwidthLimit}
                onChange={e => handleSetBandwidthLimit(e.target.value)}
                className="w-20 bg-white/4 border border-white/6 rounded-lg px-3! py-2! text-[13px] text-[#e8edf2] text-center outline-none caret-apple-primary transition-all duration-150 focus:border-apple-primary focus:bg-white/6"
              />
              <span className="text-[12px] text-[#5a6a7a]">KB/s</span>
            </div>
          }
        />
      </Section>

      {/* Performance */}
      <Section icon={IconZap} title={t("setting.download.performance")}>
        <Row
          label={t("setting.download.performanceMode.label")}
          desc={t("setting.download.performanceMode.desc")}
          right={
            <Select
              value={performance}
              onChange={handleSetPerformance}
              options={[
                { value: "normal", label: t("setting.download.performanceMode.normal") },
                { value: "high", label: t("setting.download.performanceMode.high") },
              ]}
            />
          }
        />
      </Section>

      {/* Integrity */}
      <Section icon={IconShield} title={t("setting.download.integrity")}>
        <Row
          label={t("setting.download.integrityEnable.label")}
          desc={t("setting.download.integrityEnable.desc")}
          right={<Toggle on={integrityEnabled} onChange={handleSetIntegrityEnabled} />}
        />
        <Row
          label={t("setting.download.integrityAlgo.label")}
          desc={t("setting.download.integrityAlgo.desc")}
          dimmed={!integrityEnabled}
          right={
            <Select
              value={integrityAlgo}
              onChange={handleSetIntegrityAlgo}
              disabled={!integrityEnabled}
              options={[
                { value: "MD5", label: "MD5" },
                { value: "SHA1", label: "SHA1" },
                { value: "SHA256", label: "SHA256" },
              ]}
            />
          }
        />
      </Section>

      {/* Recovery */}
      <Section icon={IconRefresh} title={t("setting.download.recovery")}>
        <Row
          label={t("setting.download.autoResume.label")}
          desc={t("setting.download.autoResume.desc")}
          right={<Toggle on={autoResume} onChange={handleSetAutoResume} />}
        />
      </Section>
    </>
  );
};

export { DownloadPage };
