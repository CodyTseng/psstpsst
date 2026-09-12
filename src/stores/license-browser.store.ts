import { create } from 'zustand';

/** Keep browsing context when the wide navigator unmounts the catalog for a detail. */
export const useLicenseBrowserStore = create<{
  query: string;
  setQuery: (query: string) => void;
}>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
