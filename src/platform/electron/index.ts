import { electronImageCacheAdapter } from './image-cache';
import { getDialogPresenter } from '../dialog-presenter';
import { electronBundledNoticesAdapter } from './bundled-notices';
import { base64 } from '@scure/base';
import type { PlatformAdapters } from '../ports';
import { getElectronBridge } from './bridge';
import { electronDatabaseAdapter } from './database';
import { electronFileSystemAdapter } from './file-system';
import { electronVideoThumbnailAdapter } from './video-thumbnail';

export { installElectronScrollbarVisibility } from './scrollbar-visibility';

export function createElectronAdapters(): PlatformAdapters {
  const bridge = getElectronBridge();
  let appState: 'active' | 'background' = document.hidden ? 'background' : 'active';
  const appStateListeners = new Set<(state: 'active' | 'background') => void>();
  document.addEventListener('visibilitychange', () => {
    appState = document.hidden ? 'background' : 'active';
    for (const listener of appStateListeners) listener(appState);
  });

  const notifyNetwork = (listener: (state: { isConnected: boolean }) => void) =>
    listener({ isConnected: navigator.onLine });

  return {
    bundledNotices: electronBundledNoticesAdapter,
    appUpdate: {
      getStatus: () => bridge.appUpdate.getStatus(),
      download: () => bridge.appUpdate.download(),
      install: () => bridge.appUpdate.install(),
      addStatusListener: (listener) => bridge.appUpdate.onStatus(listener),
    },
    confirmationDialog: {
      // Prefer the renderer presenter (design-system dialog with role-styled
      // buttons); the native main-process message box remains the fallback
      // before the root dialog host mounts.
      confirm: (options) =>
        getDialogPresenter()?.confirm(options) ?? bridge.dialogs.confirm(options),
      notify: (options) =>
        getDialogPresenter()?.notify(options) ?? bridge.dialogs.notify(options),
    },
    database: electronDatabaseAdapter,
    secureStorage: bridge.secureStorage,
    imageCache: electronImageCacheAdapter,
    fileSystem: electronFileSystemAdapter,
    fileDrop: {
      registerTarget: () => ({ remove() {} }),
    },
    videoThumbnail: electronVideoThumbnailAdapter,
    deviceCrypto: bridge.deviceCrypto,
    noise: bridge.noise,
    deepLink: {
      takePendingUrl: () => bridge.deepLink.takePendingUrl(),
      addListener: (listener) => bridge.deepLink.onAvailable(listener),
    },
    unreadIndicator: {
      async setCount(count) {
        return bridge.tray.setUnreadCount(count).then(
          () => true,
          () => false,
        );
      },
    },
    windowChrome: {
      setTheme: (theme) => bridge.windowChrome.setTheme(theme),
      setScreenshotPreview: (enabled) => bridge.windowChrome.setScreenshotPreview(enabled),
    },
    proximityTransport: {
      isAvailable: () => bridge.proximity.isAvailable(),
      requestPermissions: () => bridge.proximity.requestPermissions(),
      startAdvertisingAsync: (profile) => bridge.proximity.startAdvertising(base64.encode(profile)),
      updateProfileAsync: (profile) => bridge.proximity.updateProfile(base64.encode(profile)),
      preferPeripheralAsync: (endpointId) => bridge.proximity.preferPeripheral(endpointId),
      disconnectAsync: (endpointId) => bridge.proximity.disconnect(endpointId),
      startScanAsync: (scanDurationMs) => bridge.proximity.startScan(scanDurationMs),
      stopScanAsync: () => bridge.proximity.stopScan(),
      stopSessionAsync: () => bridge.proximity.stopSession(),
      refreshPeerProfileAsync: (endpointId) => bridge.proximity.refreshPeerProfile(endpointId),
      sendAsync: (endpointId, payload) => bridge.proximity.send(endpointId, base64.encode(payload)),
      addListener(name, listener) {
        const remove = bridge.proximity.onEvent((eventName, event) => {
          if (eventName !== name) return;
          if (name === 'onPeer' && typeof event.profile === 'string') {
            listener({ ...event, profile: base64.decode(event.profile) });
            return;
          }
          if (name === 'onMessage' && typeof event.payload === 'string') {
            listener({ ...event, payload: base64.decode(event.payload) });
            return;
          }
          listener(event);
        });
        return { remove };
      },
    },
    cryptoAccelerator: {
      isAvailable: () => false,
      getNip44ConversationKey: () => Promise.resolve(null),
      verifySchnorr: () => null,
    },
    notifications: {
      isAvailable: () => bridge.notifications.isSupported(),
      // Notify whenever the user isn't looking at the app: the window hidden
      // (tray) or visible but unfocused. The cached bridge value combines both
      // states even though its legacy API name refers only to focus.
      shouldNotifyNow: () => !bridge.windowFocus.isFocused(),
      addUserReturnedListener(listener) {
        return bridge.windowFocus.onChange((focused) => {
          if (focused) listener();
        });
      },
      hasPermission: () => bridge.notifications.hasPermission(),
      ensurePermission: () => bridge.notifications.ensurePermission(),
      openSettings: () => bridge.notifications.openSettings(),
      setDefaultHandler() {},
      present: (content) => bridge.notifications.show(content),
      dismissAll: () => bridge.notifications.dismissAll(),
    },
    backgroundTask: {
      defineTasks(_names, run) {
        bridge.backgroundTask.setRunner(() =>
          run({ signal: new AbortController().signal }),
        );
      },
      register: (minimumIntervalMinutes) =>
        bridge.backgroundTask.register(minimumIntervalMinutes),
      unregister: () => bridge.backgroundTask.unregister(),
    },
    backgroundMessaging: {
      isAvailable: () => false,
      isBatteryOptimizationExempt: () => Promise.resolve(true),
      requestBatteryOptimizationExemption: () => Promise.resolve(false),
      addPulseListener: () => () => {},
      schedulePulse: async () => {},
      start: () => Promise.resolve(false),
      stop: () => Promise.resolve(),
    },
    zipArchive: {
      isAvailable: () => Promise.resolve(true),
      zip: (sourcePath, targetPath) => bridge.zip.create(sourcePath, targetPath),
      unzip: (sourcePath, targetPath) => bridge.zip.extract(sourcePath, targetPath),
      getUncompressedSize: (archivePath) => bridge.zip.uncompressedSize(archivePath),
      addProgressListener(listener) {
        const remove = bridge.zip.onProgress(listener);
        return { remove };
      },
    },
    localAuth: {
      hasEnrolledAuth: () => bridge.localAuth.hasEnrolledAuth(),
      authenticate: ({ promptMessage }) => bridge.localAuth.authenticate(promptMessage),
    },
    mediaLibrary: {
      requestWritePermission: () => Promise.resolve(true),
      async saveToLibrary(uri) {
        if (!(await bridge.dialogs.saveMedia(uri))) throw new Error('Save canceled');
      },
    },
    sharing: {
      isAvailable: () => Promise.resolve(true),
      async share(uri) {
        const name = decodeURIComponent(uri.split('/').pop() ?? 'psstpsst-export');
        await bridge.dialogs.shareFile(uri, name);
      },
    },
    networkState: {
      getState: () => Promise.resolve({ isConnected: navigator.onLine }),
      addStateListener(listener) {
        window.addEventListener('online', () => notifyNetwork(listener));
        window.addEventListener('offline', () => notifyNetwork(listener));
      },
    },
    imageManipulator: {
      async renderAndSave(uri, options) {
        if (uri.startsWith('psstpsst-file://')) return bridge.image.renderAndSave(uri, options);
        const cacheUri = `${await bridge.fileSystem.cacheDirectoryUri()}image-input-${await bridge.deviceCrypto.randomUUID()}`;
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Unable to stage image (${response.status})`);
        await bridge.fileSystem.writeBytes(cacheUri, new Uint8Array(await response.arrayBuffer()));
        try {
          return await bridge.image.renderAndSave(cacheUri, options);
        } finally {
          await bridge.fileSystem.delete(cacheUri, true);
        }
      },
    },
    documentPicker: {
      pickDocument: ({ type }) => bridge.dialogs.pickDocument(type),
    },
    appState: {
      currentState: () => appState,
      addChangeListener(listener) {
        appStateListeners.add(listener);
        return () => appStateListeners.delete(listener);
      },
    },
    urlOpener: {
      openExternalUrl: (url) => bridge.system.openExternalUrl(url),
    },
    localization: {
      preferredLanguageTag: () => navigator.languages[0] ?? null,
    },
    audioSession: {
      setPlaybackMode: () => Promise.resolve(),
      setRecordingMode: () => Promise.resolve(),
    },
  };
}
