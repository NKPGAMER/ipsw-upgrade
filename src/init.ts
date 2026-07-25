import { IPSWClient } from "./core/ipswClient.js";
import { state } from "./data.js";
import { store } from "./services/api.js";

import i18n from "./i18n.js";

export const ipswClient = new IPSWClient();

async function init() {
  await Promise.all([
    store.get("ipswFolder"),
    store.get("link_enabled"),
    store.get("cleanup_remove_old"),
    store.get("cleanup_remove_duplicate"),
    store.get("language"),
  ]).then(
    ([
      savedFolder,
      savedNormalizeName,
      savedDeleteOld,
      savedDeleteDuplicate,
      savedLanguage,
    ]) => {
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
    },
  );

  state.__init = true;
}

init();
