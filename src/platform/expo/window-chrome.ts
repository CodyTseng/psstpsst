import type { WindowChromePort } from '../ports/window-chrome';

/** Mobile and ordinary web own no native window frame; keep the sync benign. */
export const windowChromeAdapter: WindowChromePort = {
  getFocusState: async () => true,
  addFocusListener: () => () => {},
  setTitle: () => Promise.resolve(),
  setTheme: () => Promise.resolve(),
  setScreenshotPreview: () => Promise.resolve(),
};
