import { useState, useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "./Section";
import { Row } from "./Row";
import { IconTheme } from "./icons";
import { store } from "@/services/api";

export type ControlStyle = "windows" | "apple";
export type ControlPosition = "left" | "right";

const ThemePage: FC = () => {
  const [controlStyle, setControlStyle] = useState<ControlStyle>("windows");
  const [controlPosition, setControlPosition] = useState<ControlPosition>("right");
  const { t } = useTranslation();

  useEffect(() => {
    store.get("controlStyle").then((v: ControlStyle | undefined) => {
      if (v) setControlStyle(v);
    });
    store.get("controlPosition").then((v: ControlPosition | undefined) => {
      if (v) setControlPosition(v);
    });
  }, []);

  return (
    <Section icon={IconTheme} title={t("setting.theme")}>
      <Row
        label={t("setting.theme.controlStyle.label")}
        desc={t("setting.theme.controlStyle.desc")}
        right={
          <div className="flex gap-2!">
            {(["windows", "apple"] as ControlStyle[]).map((style) => (
              <button
                key={style}
                onClick={() => { setControlStyle(style); store.set("controlStyle", style); }}
                className={[
                  "px-4! py-2! rounded-lg text-[13px] font-medium border transition-all duration-150 cursor-pointer select-none",
                  controlStyle === style
                    ? "bg-apple-primary/12 border-apple-primary text-apple-primary-on-dark"
                    : "bg-white/4 border-white/6 text-white hover:border-[#0066cc33] hover:text-white",
                ].join(" ")}
              >
                {style === "apple" ? "Apple" : "Windows"}
              </button>
            ))}
          </div>
        }
      />
      <Row
        label={t("setting.theme.controlPosition.label")}
        desc={t("setting.theme.controlPosition.desc")}
        right={
          <div className="flex gap-2!">
            {(["left", "right"] as ControlPosition[]).map((pos) => (
              <button
                key={pos}
                onClick={() => { setControlPosition(pos); store.set("controlPosition", pos); }}
                className={[
                  "px-4! py-2! rounded-lg text-[13px] font-medium border transition-all duration-150 cursor-pointer select-none",
                  controlPosition === pos
                    ? "bg-apple-primary/12 border-apple-primary text-apple-primary-on-dark"
                    : "bg-white/4 border-white/6 text-white hover:border-[#0066cc33] hover:text-white",
                ].join(" ")}
              >
                {pos === "left" ? t("setting.theme.controlPosition.left") : t("setting.theme.controlPosition.right")}
              </button>
            ))}
          </div>
        }
      />
    </Section>
  );
};

export { ThemePage };
