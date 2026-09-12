import { create } from 'zustand';

import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { wideLayout } from '@/theme/layout';

const PRIMARY_WIDTH_KEY = 'desktop.primaryPaneWidth';

type State = {
  primaryWidth: number;
  loaded: boolean;
  load: () => Promise<void>;
  setPrimaryWidth: (width: number) => void;
};

export const useDesktopLayoutStore = create<State>((set, get) => ({
  primaryWidth: wideLayout.primaryDesktopWidth,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const stored = Number(await getDevicePreference(PRIMARY_WIDTH_KEY));
      if (!get().loaded && Number.isSafeInteger(stored) && stored >= wideLayout.primaryDesktopMinWidth) {
        set({ primaryWidth: stored });
      }
    } catch (error) {
      console.warn('[layout] Failed to restore primary pane width.', error);
    } finally {
      set({ loaded: true });
    }
  },
  setPrimaryWidth: (width) => {
    if (!Number.isSafeInteger(width) || width < wideLayout.primaryDesktopMinWidth) return;
    if (get().primaryWidth === width) return;
    set({ primaryWidth: width, loaded: true });
    void trySetDevicePreference(PRIMARY_WIDTH_KEY, String(width));
  },
}));
