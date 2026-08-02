import 'i18next';
import lang_vi from "../src/assets/locales/vi.json";

declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'translation';
        resources: {
            translation: typeof lang_vi;
        };
        allowObjectInHTMLChildren: true;
    }
}