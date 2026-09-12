import { IS_ELECTRON } from './src/lib/platform';
// Import the registry directly: React Refresh inspects barrel exports and
// touching the exported platform proxy would install Expo adapters too early.
import { initPlatformAdapters } from './src/platform/registry';

if (IS_ELECTRON) {
  // Metro development and packaged export both load the same global CSS. Mark
  // the document before Expo Router evaluates so desktop-only browser resets
  // apply on the first frame without affecting ordinary web.
  document.documentElement.dataset.psstpsstElectron = '';
  // Keep desktop-only adapters out of ordinary runtime evaluation while still
  // installing them synchronously before Expo Router loads route modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElectronAdapters, installElectronScrollbarVisibility } = require('./src/platform/electron') as typeof import('./src/platform/electron');
  installElectronScrollbarVisibility();
  initPlatformAdapters(createElectronAdapters());
}

// Expo Router's custom-entry contract requires this import to remain last.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('expo-router/entry');
