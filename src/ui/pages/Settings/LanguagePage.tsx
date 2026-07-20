import { useState, useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "./Section";
import { Row } from "./Row";
import { IconLanguage } from "./icons";
import type { Language } from "./types";

const LanguagePage: FC = () => {
  const [language, setLanguage] = useState<Language>("vi");
  const { t, i18n } = useTranslation();

  useEffect(() => {
    window.store.get("language").then((lang: string) => {
      if (lang) setLanguage(lang as Language);
    });
  }, []);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    window.store.set("language", lang);
  };

  return (
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
                    ? "bg-apple-primary/12 border-apple-primary text-apple-primary-on-dark"
                    : "bg-white/4 border-white/6 text-white hover:border-[#0066cc33] hover:text-white",
                ].join(" ")}
              >
                {lang === "en" ? "English" : "Tiếng Việt"}
              </button>
            ))}
          </div>
        }
      />
    </Section>
  );
};

export { LanguagePage };
