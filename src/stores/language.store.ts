import { create } from 'zustand';

import i18n, { getSystemLanguage, type Language, LANGUAGES } from '@/i18n';
import {
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';

/** A device-level language preference: follow the OS, or lock to one language. */
export type LanguagePreference = 'system' | Language;

/** Device-level (not per-account), persisted as a non-secret SQLite preference.
 * Default to following the system. */
const PREFERENCE_KEY = 'language.preference';

function isPreference(value: string | null): value is LanguagePreference {
  return value === 'system' || (value != null && (LANGUAGES as readonly string[]).includes(value));
}

/** Resolve a preference to the concrete language i18n should run in. */
function resolve(preference: LanguagePreference): Language {
  return preference === 'system' ? getSystemLanguage() : preference;
}

type State = {
  preference: LanguagePreference;
  /** False until the persisted value has been read once (gated at bootstrap so
   * the first painted frame is already in the chosen language — no flash). */
  loaded: boolean;
  load: () => Promise<void>;
  setPreference: (preference: LanguagePreference) => Promise<void>;
};

export const useLanguageStore = create<State>((set) => ({
  preference: 'system',
  loaded: false,
  load: async () => {
    try {
      const stored = await getDevicePreference(PREFERENCE_KEY, PREFERENCE_KEY);
      const preference = isPreference(stored) ? stored : 'system';
      await i18n.changeLanguage(resolve(preference));
      set({ preference });
    } catch (error) {
      console.warn('[language] Failed to restore the language preference.', error);
    } finally {
      set({ loaded: true });
    }
  },
  setPreference: async (preference) => {
    // Paint the selected row immediately, but persist before changing i18next.
    // A switch between LTR and RTL reloads the native runtime from the root
    // layout, so the next process must be able to read the new preference.
    set({ preference });
    await trySetDevicePreference(PREFERENCE_KEY, preference);
    await i18n.changeLanguage(resolve(preference)).catch((error) => {
      console.warn('[language] Failed to change language.', error);
    });
  },
}));
