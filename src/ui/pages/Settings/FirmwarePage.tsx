import { useState, useEffect, useCallback, type FC } from "react";
import { useTranslation } from "react-i18next";
import { state } from "@/data";
import utils from "@/core/utils";
import { Section } from "./Section";
import { Row } from "./Row";
import { Toggle } from "./Toggle";
import { IconSoftware } from "./icons";

const FirmwarePage: FC = () => {
  const { t } = useTranslation();
  const [normalizeName, setNormalizeName] = useState<boolean>(false);
  const [linkOutDir, setLinkOutDir] = useState<string>("IPSW_FILES");
  const [deleteOld, setDeleteOld] = useState<boolean>(false);
  const [deleteDuplicate, setDeleteDuplicate] = useState<boolean>(false);

  useEffect(() => {
    const s = state;
    setNormalizeName(s.normalizeName);
    setDeleteOld(s.autoRemoveOldFiles);
    setDeleteDuplicate(s.autoRemoveDuplicateFiles);

    window.store.get("link_out_dir").then((dir: string) => {
      if (dir) setLinkOutDir(dir);
    });
  }, []);

  const restartAppConfirm = useCallback(async () => {
    const warning = await utils.customConfirm(t("setting.restartWarning"), {
      confirmText: t("setting.restartConfirm"),
      cancelText: t("setting.restartCancel"),
      variant: "warning",
    });
    if (!warning) return;
    window.api.relaunch();
  }, [t]);

  const handleSaveLinkConfig = useCallback(async () => {
    state.normalizeName = normalizeName;
    await Promise.all([
      window.store.set("link_enabled", normalizeName),
      window.store.set("link_out_dir", linkOutDir),
    ]);
    await restartAppConfirm();
  }, [normalizeName, linkOutDir, restartAppConfirm]);

  const handleSetDeleteOld = useCallback(async (value: boolean) => {
    state.autoRemoveOldFiles = value;
    window.store.set("cleanup_remove_old", value);
    await restartAppConfirm();
    setDeleteOld(value);
  }, [restartAppConfirm]);

  const handleSetDeleteDuplicate = useCallback(async (value: boolean) => {
    state.autoRemoveDuplicateFiles = value;
    window.store.set("cleanup_remove_duplicate", value);
    await restartAppConfirm();
    setDeleteDuplicate(value);
  }, [restartAppConfirm]);

  return (
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
            className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3! py-2! text-[13px] font-mono text-[#7a7a7a] outline-none caret-[#0066cc] transition-all duration-150 focus:border-[#0066cc] focus:text-white focus:bg-white/[0.06]"
          />
          <button
            onClick={handleSaveLinkConfig}
            className="px-4! py-2! rounded-full bg-[#0066cc] text-white text-[13px] font-medium border-none cursor-pointer whitespace-nowrap transition-all duration-150 hover:bg-[#0071e3] shrink-0"
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
  );
};

export { FirmwarePage };
