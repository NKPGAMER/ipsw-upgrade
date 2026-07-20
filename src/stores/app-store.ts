import { create } from "zustand";

export interface AppState {
  normalizeName: boolean;
  currentFolder: string;
  currentProduct: Product;
  isDeletingFM: boolean;
  isUpdateAllFirmware: boolean;
  autoRemoveOldFiles: boolean;
  autoRemoveDuplicateFiles: boolean;
  isNewVersion: boolean;
  __init: boolean;
  setNormalizeName: (v: boolean) => void;
  setCurrentFolder: (v: string) => void;
  setCurrentProduct: (v: Product) => void;
  setIsDeletingFM: (v: boolean) => void;
  setIsUpdateAllFirmware: (v: boolean) => void;
  setAutoRemoveOldFiles: (v: boolean) => void;
  setAutoRemoveDuplicateFiles: (v: boolean) => void;
  setIsNewVersion: (v: boolean) => void;
  setInit: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  normalizeName: false,
  currentFolder: "",
  currentProduct: "iphone" as Product,
  isDeletingFM: false,
  isUpdateAllFirmware: false,
  autoRemoveOldFiles: false,
  autoRemoveDuplicateFiles: false,
  isNewVersion: false,
  __init: false,
  setNormalizeName: (v) => set({ normalizeName: v }),
  setCurrentFolder: (v) => set({ currentFolder: v }),
  setCurrentProduct: (v) => set({ currentProduct: v }),
  setIsDeletingFM: (v) => set({ isDeletingFM: v }),
  setIsUpdateAllFirmware: (v) => set({ isUpdateAllFirmware: v }),
  setAutoRemoveOldFiles: (v) => set({ autoRemoveOldFiles: v }),
  setAutoRemoveDuplicateFiles: (v) => set({ autoRemoveDuplicateFiles: v }),
  setIsNewVersion: (v) => set({ isNewVersion: v }),
  setInit: (v) => set({ __init: v }),
}));
