import { create } from 'zustand';

import {
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';
import { ACCENTS, type AccentKey } from '@/theme/accents';

/** A device-level appearance preference: follow the OS, or lock to one mode. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Device-level (not per-account), persisted as non-secret SQLite preferences.
 * Default to system + the blue accent. */
const PREFERENCE_KEY = 'theme.preference';
const ACCENT_KEY = 'theme.accent';

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isAccent(value: string | null): value is AccentKey {
  return value != null && value in ACCENTS;
}

type State = {
  preference: ThemePreference;
  /** The chosen accent (brand) colour key — keys into `ACCENTS` (`src/theme`). */
  accent: AccentKey;
  /** False until the persisted values have been read once (gated at bootstrap so
   * the first painted frame already uses the right palette — no flash). */
  loaded: boolean;
  load: () => Promise<void>;
  setPreference: (preference: ThemePreference) => void;
  setAccent: (accent: AccentKey) => void;
};

export const useThemeStore = create<State>((set) => ({
  preference: 'system',
  accent: 'blue',
  loaded: false,
  load: async () => {
    const [storedPreference, storedAccent] = await Promise.all([
      getDevicePreference(PREFERENCE_KEY, PREFERENCE_KEY),
      getDevicePreference(ACCENT_KEY, ACCENT_KEY),
    ]);
    set({
      preference: isPreference(storedPreference) ? storedPreference : 'system',
      accent: isAccent(storedAccent) ? storedAccent : 'blue',
      loaded: true,
    });
  },
  setPreference: (preference) => {
    // Optimistic: update state immediately so the switch is instant, then
    // persist in the background.
    set({ preference });
    void trySetDevicePreference(PREFERENCE_KEY, preference);
  },
  setAccent: (accent) => {
    set({ accent });
    void trySetDevicePreference(ACCENT_KEY, accent);
  },
}));
