import i18next, { InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Languages
import lang_vi from "./assets/locales/vi.json";
import lang_en from "./assets/locales/en.json";

const resources: InitOptions['resources'] = {
  vi: { translation: lang_vi },
  en: { translation: lang_en }
}

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'vi',
    interpolation: {
      escapeValue: false
    }
  });

export default i18next;