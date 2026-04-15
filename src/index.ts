import { IPSWClient } from "./core/ipswClient.js";
import { data, state } from "./data.js";

import i18n from './i18n.js';

export const ipswClient = new IPSWClient();

async function init() {
    Promise.all([
        window.store.get('ipswFolder'),
        window.store.get('autoRemoveOldFiles'),
        window.store.get('autoRemoveDuplicateFiles'),
        window.store.get('language'),
    ]).then(([savedFolder, savedDeleteOld, savedDeleteDuplicate, savedLanguage]) => {
        if (savedFolder) {
            state.currentFolder = savedFolder;
            ipswClient.changeDir(savedFolder)
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