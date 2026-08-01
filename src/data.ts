import { useAppStore } from "./stores/app-store";

export interface DeviceGroup {
  name: string;
  ids: string[];
}

export const DEVICE_GROUPS: Record<Product, DeviceGroup[]> = {
  iphone: [
    { name: "iPhone 17 Series", ids: ["iPhone18,1", "iPhone18,2", "iPhone18,3", "iPhone18,4", "iPhone18,5"] },
    { name: "iPhone 16 Series", ids: ["iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4", "iPhone17,5"] },
    { name: "iPhone 15 Series", ids: ["iPhone16,1", "iPhone16,2", "iPhone15,4", "iPhone15,5"] },
    { name: "iPhone 14 Series", ids: ["iPhone15,2", "iPhone15,3", "iPhone14,7", "iPhone14,8"] },
    { name: "iPhone 13 Series", ids: ["iPhone14,2", "iPhone14,3", "iPhone14,4", "iPhone14,5", "iPhone14,6"] },
    { name: "iPhone 12 Series", ids: ["iPhone13,1", "iPhone13,2", "iPhone13,3", "iPhone13,4"] },
    { name: "iPhone 11 Series", ids: ["iPhone12,1", "iPhone12,3", "iPhone12,5", "iPhone12,8"] },
    { name: "iPhone X Series", ids: ["iPhone10,3", "iPhone10,6", "iPhone11,2", "iPhone11,4", "iPhone11,6", "iPhone11,8"] },
    { name: "iPhone 8 Series", ids: ["iPhone10,1", "iPhone10,2", "iPhone10,4", "iPhone10,5"] },
    { name: "iPhone 7 Series", ids: ["iPhone9,1", "iPhone9,2", "iPhone9,3", "iPhone9,4"] },
    { name: "iPhone 6 Series", ids: ["iPhone7,1", "iPhone7,2", "iPhone8,1", "iPhone8,2", "iPhone8,4"] },
    { name: "iPhone 5 Series", ids: ["iPhone5,1", "iPhone5,2", "iPhone5,3", "iPhone5,4", "iPhone6,1", "iPhone6,2"] },
    { name: "iPhone 4 Series", ids: ["iPhone3,1", "iPhone3,2", "iPhone3,3", "iPhone4,1"] },
    { name: "iPhone 3 Series", ids: ["iPhone1,2", "iPhone2,1"] },
    { name: "iPhone 2 Series", ids: ["iPhone1,1"] },
  ],
  ipad: [],
  watch: [],
  mac: [],
  realitydevice: [],
  tv: [],
  homepod: [],
  ipod: [],
};

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
  get isNewVersion() { return useAppStore.getState().isNewVersion; },
  set isNewVersion(v: boolean) { useAppStore.getState().setIsNewVersion(v); },
  get __init() { return useAppStore.getState().__init; },
  set __init(v: boolean) { useAppStore.getState().setInit(v); },
};
