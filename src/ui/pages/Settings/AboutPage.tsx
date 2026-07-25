import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "./Section";
import { Row } from "./Row";
import { IconAbout } from "./icons";
import { app } from "@/services/api";

const AboutPage: FC = memo(function AboutPage() {
  const { t } = useTranslation();

  return (
    <Section icon={IconAbout} title={t("setting.about")}>
      <Row
        label={t("app.version.title")}
        right={
          <span className="font-bold text-[12px] text-apple-primary-on-dark bg-white/6 border border-white/6 px-3! py-1! rounded-full tracking-[0.04em]">
            {app.version} - Premium Edition - VIP
          </span>
        }
      />
      <Row
        label={t("app.developer")}
        right={
          <div className="flex items-center gap-3!">
            <div className="w-9 h-9 rounded-full bg-apple-primary flex items-center justify-center text-[14px] font-bold text-white shrink-0">
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
  );
});

export { AboutPage };
