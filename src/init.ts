import { IPSWClient } from "./core/ipswClient.js";
import { state } from "./data.js";
import { commands } from "./bind.js";

import i18n from './i18n.js';


export const ipswClient = new IPSWClient();
(globalThis as any).commands = commands;
(globalThis as any).ipswClient = ipswClient;

async function init() {
    await Promise.all([
        commands.storeGet('root_folder'),
        commands.storeGet('language')
    ]).then(([
        rootFolder,
        language
    ]) => {


        if (language.status === "ok") {
            i18n.changeLanguage(language.data ?? "vi")
        }
    });

    // const [rootFolder, language] = result;
    // Promise.all([
    //     window.store.get('ipswFolder'),
    //     window.store.get('link_enabled'),
    //     window.store.get('cleanup_remove_old'),
    //     window.store.get('cleanup_remove_duplicate'),
    //     window.store.get('language'),
    //     window.store.get('turboMode')
    // ]).then(([savedFolder, savedNormalizeName, savedDeleteOld, savedDeleteDuplicate, savedLanguage, savedTurboMode]) => {
    //     if (savedFolder) {
    //         state.currentFolder = savedFolder;
    //         // ipswClient.changeDir(savedFolder)
    //     }
    //     if (savedNormalizeName !== undefined && savedNormalizeName !== null) {
    //         state.normalizeName = savedNormalizeName;
    //     }
    //     if (savedDeleteOld !== undefined && savedDeleteOld !== null) {
    //         state.autoRemoveOldFiles = savedDeleteOld;
    //     }
    //     if (savedDeleteDuplicate !== undefined && savedDeleteDuplicate !== null) {
    //         state.autoRemoveDuplicateFiles = savedDeleteDuplicate;
    //     }
    //     if (savedLanguage) {
    //         i18n.changeLanguage(savedLanguage);
    //     }
    //     if (savedTurboMode !== undefined && savedTurboMode !== null) {
    //         state.turboMode = savedTurboMode;
    //     }
    // });

    state.__init = true;
};

init();