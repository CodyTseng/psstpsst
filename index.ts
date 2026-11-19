import { IS_ANDROID, IS_ELECTRON } from './src/lib/platform';
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: Constants } = require('expo-constants') as typeof import('expo-constants');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordVideoPlaybackError } = require('./src/services/diagnostics/app-error-diagnostics.service') as typeof import('./src/services/diagnostics/app-error-diagnostics.service');
  const chromiumVersion = navigator.userAgent.match(/\bChrome\/([\d.]+)/)?.[1] ?? 'unknown';
  // Media errors do not bubble. Capture before the player can unmount the video.
  document.addEventListener('error', ({ target }) => {
    if (!(target instanceof HTMLVideoElement) || !target.error) return;
    const { code, message } = target.error;
    const scheme = (target.currentSrc || target.src).split(':', 1)[0];
    void recordVideoPlaybackError({
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      chromiumVersion,
      code,
      message,
      currentTime: target.currentTime,
      duration: Number.isFinite(target.duration) ? target.duration : undefined,
      source: scheme === 'psstpsst-file' ? 'attachment'
        : scheme === 'http' || scheme === 'https' ? 'remote' : 'other',
    });
  }, true);
}

if (IS_ANDROID) {
  // Register the independent task surface on the same trusted ReactHost.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppRegistry } = require('react-native') as typeof import('react-native');
  AppRegistry.registerComponent('PsstApplicationTask', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./src/components/napplet/ApplicationTaskRoot').ApplicationTaskRoot;
  });
}

// Expo Router's custom-entry contract requires this import to remain last.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('expo-router/entry');
