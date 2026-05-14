import { useAppStore } from "./stores/app-store";

export const state = {
  get normalizeName() { return useAppStore.getState().normalizeName; },
  set normalizeName(v: boolean) { useAppStore.getState().setNormalizeName(v); },
  get currentFolder() { return useAppStore.getState().currentFolder; },
  set currentFolder(v: string) { useAppStore.getState().setCurrentFolder(v); },
  get currentProduct() { return useAppStore.getState().currentProduct; },
  set currentProduct(v: Product) { useAppStore.getState().setCurrentProduct(v); },
  get isDeletingFM() { return useAppStore.getState().isDeletingFM; },
  set isDeletingFM(v: boolean) { useAppStore.getState().setIsDeletingFM(v); },
  get isUpdateAllFirmware() { return useAppStore.getState().isUpdateAllFirmware; },
  set isUpdateAllFirmware(v: boolean) { useAppStore.getState().setIsUpdateAllFirmware(v); },
  get autoRemoveOldFiles() { return useAppStore.getState().autoRemoveOldFiles; },
  set autoRemoveOldFiles(v: boolean) { useAppStore.getState().setAutoRemoveOldFiles(v); },
  get autoRemoveDuplicateFiles() { return useAppStore.getState().autoRemoveDuplicateFiles; },
  set autoRemoveDuplicateFiles(v: boolean) { useAppStore.getState().setAutoRemoveDuplicateFiles(v); },
  get turboMode() { return useAppStore.getState().turboMode; },
  set turboMode(v: boolean) { useAppStore.getState().setTurboMode(v); },
  get isNewVersion() { return useAppStore.getState().isNewVersion; },
  set isNewVersion(v: boolean) { useAppStore.getState().setIsNewVersion(v); },
  get __init() { return useAppStore.getState().__init; },
  set __init(v: boolean) { useAppStore.getState().setInit(v); },
};
