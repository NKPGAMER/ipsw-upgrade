import { create } from "zustand";

export interface SearchState {
  query: string;
  debouncedQuery: string;
  isGlobalMode: boolean;
  customDevices: Device[] | null;
  /** Search bar visibility — hidden by default, enabled when Home/SelectDevice mounts */
  searchVisible: boolean;
  /** Whether we navigated to Downloads/Settings from SelectDevice (shows close button) */
  fromSelectDevice: boolean;

  setQuery: (q: string) => void;
  setDebouncedQuery: (q: string) => void;
  setGlobalMode: (v: boolean) => void;
  setCustomDevices: (devices: Device[] | null) => void;
  setSearchVisible: (v: boolean) => void;
  setFromSelectDevice: (v: boolean) => void;
  /** Only clear query text — no navigation side effects */
  clearSearchQuery: () => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  debouncedQuery: "",
  isGlobalMode: false,
  customDevices: null,
  searchVisible: false,
  fromSelectDevice: false,

  setQuery: (query) => set({ query }),
  setDebouncedQuery: (debouncedQuery) => set({ debouncedQuery }),
  setGlobalMode: (isGlobalMode) => set({ isGlobalMode }),
  setCustomDevices: (customDevices) => set({ customDevices }),
  setSearchVisible: (searchVisible) => set({ searchVisible }),
  setFromSelectDevice: (fromSelectDevice) => set({ fromSelectDevice }),
  clearSearchQuery: () => set({ query: "", debouncedQuery: "" }),
  reset: () =>
    set({ query: "", debouncedQuery: "", isGlobalMode: false, customDevices: null, searchVisible: false }),
}));

export const getSearchState = () => useSearchStore.getState();
