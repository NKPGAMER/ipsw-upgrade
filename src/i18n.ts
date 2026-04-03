import i18next, { InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Languages
import lang_vi from "./locales/vi.json";
import lang_en from "./locales/en.json";

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

function applyLang(): void {
  const elements = document.querySelectorAll('[data-t]');
  elements.forEach(el => {
    const rawKey = el.getAttribute('data-t') as string;
    const parts = rawKey.split(';');

    parts?.forEach(part => {
      if (part.startsWith('[')) {
        const match = part.match(/\[(.*)\](.*)/);
        if (match) {
          const [_, attr, key] = match;
          el.setAttribute(attr, i18next.t(key as any));
        }
      } else {
        el.textContent = i18next.t(part as any);
      }
    })
  });
}

i18next.on('initialized', () => {
  applyLang();
});

i18next.on('languageChanged', () => {
  applyLang();
})

export default i18next;