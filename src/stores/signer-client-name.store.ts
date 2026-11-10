import { create } from 'zustand';

import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { DEFAULT_SIGNER_CLIENT_NAME } from '@/services/signer/client-metadata';

const PREFERENCE_KEY = 'signer.clientName';
const SAVE_DELAY_MS = 400;
let loading: Promise<void> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writes = Promise.resolve();

type State = {
  name: string;
  loaded: boolean;
  load(): Promise<void>;
  setName(name: string): void;
};

/** Shared by both pairing flows and retained independently of account sessions. */
export const useSignerClientNameStore = create<State>((set, get) => ({
  name: DEFAULT_SIGNER_CLIENT_NAME,
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      try {
        const saved = await getDevicePreference(PREFERENCE_KEY);
        // A user edit while storage is loading wins over the saved value.
        if (!get().loaded) set({ name: saved?.trim() || DEFAULT_SIGNER_CLIENT_NAME });
      } catch (error) {
        console.warn('[signer] Failed to restore application name.', error);
      } finally {
        set({ loaded: true });
      }
    })();
    return loading;
  },
  setName: name => {
    if (name === get().name) return;
    set({ name, loaded: true });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const saved = get().name.trim() || DEFAULT_SIGNER_CLIENT_NAME;
      // Serialize writes so a slower older save cannot replace the latest edit.
      writes = writes.then(() => trySetDevicePreference(PREFERENCE_KEY, saved));
    }, SAVE_DELAY_MS);
  },
}));
