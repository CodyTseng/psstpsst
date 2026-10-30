import { create } from 'zustand';

import {
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';
import { parseAccent, serializeAccent, type AccentSelection } from '@/theme/accents';
import { createThemePalettes, defaultThemePalettes, type ThemePalettes } from '@/theme/palette';

/** A device-level appearance preference: follow the OS, or lock to one mode. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Device-level (not per-account), persisted as non-secret SQLite preferences.
 * Default to system + the blue accent. */
const PREFERENCE_KEY = 'theme.preference';
const ACCENT_KEY = 'theme.accent';

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

type State = {
  preference: ThemePreference;
  /** The chosen accent (brand) colour key — preset key, legacy RGB, or explicit light/dark custom settings. */
  accent: AccentSelection;
  /** Derived from the current accent, updated atomically and never persisted. */
  palettes: ThemePalettes;
  /** False until the persisted values have been read once (gated at bootstrap so
   * the first painted frame already uses the right palette — no flash). */
  loaded: boolean;
  load: () => Promise<void>;
  setPreference: (preference: ThemePreference) => void;
  setAccent: (accent: AccentSelection) => void;
};

export const useThemeStore = create<State>((set, get) => ({
  preference: 'system',
  accent: 'blue',
  palettes: defaultThemePalettes,
  loaded: false,
  load: async () => {
    try {
      const [storedPreference, storedAccent] = await Promise.all([
        getDevicePreference(PREFERENCE_KEY, PREFERENCE_KEY),
        getDevicePreference(ACCENT_KEY, ACCENT_KEY),
      ]);
      const accent = parseAccent(storedAccent) ?? 'blue';
      set({
        preference: isPreference(storedPreference) ? storedPreference : 'system',
        accent,
        palettes: createThemePalettes(accent),
      });
    } catch (error) {
      console.warn('[theme] Failed to restore appearance preferences.', error);
    } finally {
      set({ loaded: true });
    }
  },
  setPreference: (preference) => {
    // Optimistic: update state immediately so the switch is instant, then
    // persist in the background.
    set({ preference });
    void trySetDevicePreference(PREFERENCE_KEY, preference);
  },
  setAccent: (accent) => {
    const normalized = parseAccent(accent);
    if (!normalized || serializeAccent(normalized) === serializeAccent(get().accent)) return;
    set({ accent: normalized, palettes: createThemePalettes(normalized) });
    void trySetDevicePreference(ACCENT_KEY, serializeAccent(normalized));
  },
}));
