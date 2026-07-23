import { create } from "zustand";

export interface SearchState {
  query: string;
  debouncedQuery: string;
  isGlobalMode: boolean;
  customDevices: Device[] | null;

  setQuery: (q: string) => void;
  setDebouncedQuery: (q: string) => void;
  setGlobalMode: (v: boolean) => void;
  setCustomDevices: (devices: Device[] | null) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  debouncedQuery: "",
  isGlobalMode: false,
  customDevices: null,

  setQuery: (query) => set({ query }),
  setDebouncedQuery: (debouncedQuery) => set({ debouncedQuery }),
  setGlobalMode: (isGlobalMode) => set({ isGlobalMode }),
  setCustomDevices: (customDevices) => set({ customDevices }),
  reset: () =>
    set({ query: "", debouncedQuery: "", isGlobalMode: false, customDevices: null }),
}));

export const getSearchState = () => useSearchStore.getState();
