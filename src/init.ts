import { IPSWClient } from "./core/ipswClient.js";
import { state } from "./data.js";

import i18n from './i18n.js';

export const ipswClient = new IPSWClient();

async function init() {
    await Promise.all([
        window.store.get('ipswFolder'),
        window.store.get('link_enabled'),
        window.store.get('cleanup_remove_old'),
        window.store.get('cleanup_remove_duplicate'),
        window.store.get('language'),
    ]).then(([savedFolder, savedNormalizeName, savedDeleteOld, savedDeleteDuplicate, savedLanguage]) => {
        if (savedFolder) {
            state.currentFolder = savedFolder;
        }
        if (savedNormalizeName !== undefined && savedNormalizeName !== null) {
            state.normalizeName = savedNormalizeName;
        }
        if (savedDeleteOld !== undefined && savedDeleteOld !== null) {
            state.autoRemoveOldFiles = savedDeleteOld;
        }
        if (savedDeleteDuplicate !== undefined && savedDeleteDuplicate !== null) {
            state.autoRemoveDuplicateFiles = savedDeleteDuplicate;
        }
        if (savedLanguage) {
            i18n.changeLanguage(savedLanguage);
        }
    });

    state.__init = true;
};

init();