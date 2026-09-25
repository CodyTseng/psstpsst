import { create } from 'zustand';

import {
  deleteDevicePreference,
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';
import { wideLayout } from '@/theme/layout';

const PRIMARY_WIDTH_KEY = 'touch.primaryPaneWidth';

type State = {
  primaryWidth: number | null;
  loaded: boolean;
  load: () => Promise<void>;
  setPrimaryWidth: (width: number) => void;
  resetPrimaryWidth: () => void;
};

function isValidPrimaryWidth(width: number): boolean {
  return Number.isSafeInteger(width) &&
    width >= wideLayout.primaryMinWidth &&
    width <= wideLayout.primaryMaxWidth;
}

export const useTouchLayoutStore = create<State>((set, get) => ({
  primaryWidth: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const stored = Number(await getDevicePreference(PRIMARY_WIDTH_KEY));
      if (!get().loaded && isValidPrimaryWidth(stored)) {
        set({ primaryWidth: stored });
      }
    } catch (error) {
      console.warn('[layout] Failed to restore touch primary pane width.', error);
    } finally {
      set({ loaded: true });
    }
  },
  setPrimaryWidth: (width) => {
    if (!isValidPrimaryWidth(width)) return;
    if (get().primaryWidth === width) return;
    set({ primaryWidth: width, loaded: true });
    void trySetDevicePreference(PRIMARY_WIDTH_KEY, String(width));
  },
  resetPrimaryWidth: () => {
    set({ primaryWidth: null, loaded: true });
    void deleteDevicePreference(PRIMARY_WIDTH_KEY).catch((error) => {
      console.warn('[layout] Failed to reset touch primary pane width.', error);
    });
  },
}));
