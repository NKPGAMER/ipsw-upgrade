import { useState, useEffect, useCallback, type FC } from "react";
import { useTranslation } from "react-i18next";
import { state } from "@/data";
import utils from "@/core/utils";
import { Section } from "./Section";
import { Row } from "./Row";
import { Toggle } from "./Toggle";
import { IconSoftware } from "./icons";
import { app, store } from "@/services/api";

const FirmwarePage: FC = () => {
  const { t } = useTranslation();
  const [normalizeName, setNormalizeName] = useState<boolean>(
    state.normalizeName,
  );
  const [linkOutDir, setLinkOutDir] = useState<string>("IPSW_FILES");
  const [deleteOld, setDeleteOld] = useState<boolean>(state.autoRemoveOldFiles);
  const [deleteDuplicate, setDeleteDuplicate] = useState<boolean>(
    state.autoRemoveDuplicateFiles,
  );

  useEffect(() => {
    store.get("link_out_dir").then((dir: string) => {
      if (dir) setLinkOutDir(dir);
    });
  }, []);

  const handleSaveLinkConfig = useCallback(async () => {
    const confirmed = await utils.customConfirm(t("setting.restartWarning"), {
      confirmText: t("setting.restartConfirm"),
      cancelText: t("setting.restartCancel"),
      variant: "warning",
    });
    if (!confirmed) return;
    state.normalizeName = normalizeName;
    await Promise.all([
      store.set("link_enabled", normalizeName),
      store.set("link_out_dir", linkOutDir),
    ]);
    app.relaunch();
  }, [normalizeName, linkOutDir, t]);

  const handleSetDeleteOld = useCallback(
    async (value: boolean) => {
      const confirmed = await utils.customConfirm(t("setting.restartWarning"), {
        confirmText: t("setting.restartConfirm"),
        cancelText: t("setting.restartCancel"),
        variant: "warning",
      });
      if (!confirmed) return;
      state.autoRemoveOldFiles = value;
      store.set("cleanup_remove_old", value);
      setDeleteOld(value);
      app.relaunch();
    },
    [t],
  );

  const handleSetDeleteDuplicate = useCallback(
    async (value: boolean) => {
      const confirmed = await utils.customConfirm(t("setting.restartWarning"), {
        confirmText: t("setting.restartConfirm"),
        cancelText: t("setting.restartCancel"),
        variant: "warning",
      });
      if (!confirmed) return;
      state.autoRemoveDuplicateFiles = value;
      store.set("cleanup_remove_duplicate", value);
      setDeleteDuplicate(value);
      app.relaunch();
    },
    [t],
  );

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
            onChange={(e) => setLinkOutDir(e.target.value)}
            placeholder="IPSW_FILES"
            className="flex-1 min-w-0 bg-white/4 border border-white/6 rounded-lg px-3! py-2! text-[13px] font-mono text-apple-ink-muted-48 outline-none caret-apple-primary transition-all duration-150 focus:border-apple-primary focus:text-white focus:bg-white/6"
          />
          <button
            onClick={handleSaveLinkConfig}
            className="px-4! py-2! rounded-full bg-apple-primary text-white text-[13px] font-medium border-none cursor-pointer whitespace-nowrap transition-all duration-150 hover:bg-apple-primary-focus shrink-0"
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
        right={
          <Toggle on={deleteDuplicate} onChange={handleSetDeleteDuplicate} />
        }
      />
    </Section>
  );
};

export { FirmwarePage };
