import { contextBridge, ipcRenderer } from 'electron';

import type { ElectronBridge } from '../src/platform/electron/bridge';
import type { AppUpdateStatus } from '../src/platform/ports/app-update';
import { IPC } from './ipc-channels';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const appUpdateListeners = new Set<(status: AppUpdateStatus) => void>();
ipcRenderer.on(IPC.appUpdateStatus, (_event, status: AppUpdateStatus) => {
  for (const listener of appUpdateListeners) listener(status);
});

const proximityAvailable =
  process.argv.includes('--psstpsst-proximity-available=1') ||
  process.env.PSSTPSST_PROXIMITY_AVAILABLE === '1';

const databaseChangeListeners = new Set<(value: { tableName?: string }) => void>();
ipcRenderer.on(IPC.databaseChanged, (_event, value: { tableName?: string }) => {
  for (const listener of databaseChangeListeners) listener(value);
});

const zipProgressListeners = new Set<(value: number) => void>();
ipcRenderer.on(IPC.zipProgress, (_event, value: number) => {
  for (const listener of zipProgressListeners) listener(value);
});

const uploadProgressListeners = new Set<
  (value: { operationId: string; sentBytes: number; totalBytes: number }) => void
>();
ipcRenderer.on(
  IPC.fsUploadProgress,
  (_event, value: { operationId: string; sentBytes: number; totalBytes: number }) => {
    for (const listener of uploadProgressListeners) listener(value);
  },
);

const deepLinkListeners = new Set<() => void>();
ipcRenderer.on(IPC.deepLinkAvailable, () => {
  for (const listener of deepLinkListeners) listener();
});

// `Notification.isSupported()` lives in the main process. The bridge contract
// is sync (the port's capability probe), so resolve it once, eagerly, over a
// synchronous IPC round-trip at preload time.
const notificationSupported = ipcRenderer.sendSync(IPC.notificationSupported) as boolean;

// User presence, tracked from the main process's BrowserWindow visibility and
// focus events; seeded from the DOM so the cache is sane before the first IPC.
let windowFocused = !document.hidden && document.hasFocus();
const windowFocusListeners = new Set<(focused: boolean) => void>();
ipcRenderer.on(IPC.windowFocusChanged, (_event, focused: boolean) => {
  windowFocused = focused;
  for (const listener of windowFocusListeners) listener(focused);
});

const proximityListeners = new Set<
  (name: string, event: Record<string, unknown>) => void
>();
ipcRenderer.on(
  IPC.proximityEvent,
  (_event, name: string, value: Record<string, unknown>) => {
    for (const listener of proximityListeners) listener(name, value);
  },
);

const bridge: ElectronBridge = {
  appUpdate: {
    getStatus: () => invoke(IPC.appUpdateGetStatus),
    download: () => invoke(IPC.appUpdateDownload),
    install: () => invoke(IPC.appUpdateInstall),
    onStatus(listener) {
      appUpdateListeners.add(listener);
      return () => appUpdateListeners.delete(listener);
    },
  },
  database: {
    execute: (sql, params, method, transactionId) =>
      invoke(IPC.databaseExecute, sql, params, method, transactionId),
    begin: (parentTransactionId) => invoke(IPC.databaseBegin, parentTransactionId),
    commit: (transactionId) => invoke(IPC.databaseCommit, transactionId),
    rollback: (transactionId) => invoke(IPC.databaseRollback, transactionId),
    exec: (sql, transactionId) => invoke(IPC.databaseExec, sql, transactionId),
    runBatch: (sql, paramsBatch, transactionId) =>
      invoke(IPC.databaseRunBatch, sql, paramsBatch, transactionId),
    streamOpen: (sql, params) => invoke(IPC.databaseStreamOpen, sql, params),
    streamNext: (streamId) => invoke(IPC.databaseStreamNext, streamId),
    streamClose: (streamId) => invoke(IPC.databaseStreamClose, streamId),
    onChange(listener) {
      databaseChangeListeners.add(listener);
      return () => {
        databaseChangeListeners.delete(listener);
      };
    },
  },
  secureStorage: {
    accessStatus: () => invoke(IPC.secureAccessStatus),
    configurePassword: (password) => invoke(IPC.secureConfigurePassword, password),
    unlockWithPassword: (password) => invoke(IPC.secureUnlockWithPassword, password),
    getItem: (key) => invoke(IPC.secureGet, key),
    setItem: (key, value) => invoke(IPC.secureSet, key, value),
    deleteItem: (key) => invoke(IPC.secureDelete, key),
  },
  fileSystem: {
    documentDirectoryUri: () => invoke(IPC.fsDocumentDirectory),
    cacheDirectoryUri: () => invoke(IPC.fsCacheDirectory),
    availableDiskSpace: () => invoke(IPC.fsAvailableDiskSpace),
    stat: (uri) => invoke(IPC.fsStat, uri),
    makeDirectory: (uri, options) => invoke(IPC.fsMakeDirectory, uri, options),
    listDirectory: (uri) => invoke(IPC.fsListDirectory, uri),
    readText: (uri) => invoke(IPC.fsReadText, uri),
    readBase64: (uri) => invoke(IPC.fsReadBase64, uri),
    readBytes: (uri) => invoke(IPC.fsReadBytes, uri),
    writeText: (uri, contents) => invoke(IPC.fsWriteText, uri, contents),
    writeBytes: (uri, bytes) => invoke(IPC.fsWriteBytes, uri, bytes),
    openReadHandle: (uri, offset) => invoke(IPC.fsOpenReadHandle, uri, offset),
    readHandle: (id, count) => invoke(IPC.fsReadHandle, id, count),
    closeReadHandle: (id) => invoke(IPC.fsCloseReadHandle, id),
    openWriteHandle: (uri, offset, truncate) =>
      invoke(IPC.fsOpenWriteHandle, uri, offset, truncate),
    writeHandle: (id, bytes) => invoke(IPC.fsWriteHandle, id, bytes),
    closeWriteHandle: (id) => invoke(IPC.fsCloseWriteHandle, id),
    copy: (fromUri, toUri, overwrite) => invoke(IPC.fsCopy, fromUri, toUri, overwrite),
    move: (fromUri, toUri) => invoke(IPC.fsMove, fromUri, toUri),
    delete: (uri, idempotent) => invoke(IPC.fsDelete, uri, idempotent),
    downloadFile: (url, toUri, overwrite) =>
      invoke(IPC.fsDownload, url, toUri, overwrite),
    requestRemoteFile: (url, options, operationId) =>
      invoke(IPC.fsRequestRemote, url, options, operationId),
    cancelRemoteFileRequest: (operationId) =>
      invoke(IPC.fsCancelRemoteRequest, operationId),
    uploadFile: (url, fileUri, options, operationId) =>
      invoke(IPC.fsUpload, url, fileUri, options, operationId),
    addUploadProgressListener(listener) {
      uploadProgressListeners.add(listener);
      return () => uploadProgressListeners.delete(listener);
    },
    cancelUpload: (operationId) => invoke(IPC.fsCancelUpload, operationId),
    revealInFolder: (uri) => invoke(IPC.fsRevealInFolder, uri),
  },
  deviceCrypto: {
    randomUUID: () => invoke(IPC.cryptoRandomUuid),
    sha256Hex: (data) => invoke(IPC.cryptoSha256, data),
    aesGcmEncrypt: (plain, key, nonceLength) =>
      invoke(IPC.cryptoEncrypt, plain, key, nonceLength),
    aesGcmDecrypt: (cipher, key, nonce, tagLength) =>
      invoke(IPC.cryptoDecrypt, cipher, key, nonce, tagLength),
    aesGcmSeal: (plain, key, iv, additionalData) =>
      invoke(IPC.cryptoSeal, plain, key, iv, additionalData),
    aesGcmOpen: (cipher, key, iv, additionalData) =>
      invoke(IPC.cryptoOpen, cipher, key, iv, additionalData),
  },
  noise: {
    generateKeyPair: (seed) => invoke(IPC.noiseCall, 'generateKeyPair', seed),
    createHandshake: (role, staticPrivateKey, fixedEphemeralPrivateKey) =>
      invoke(IPC.noiseCall, 'createHandshake', role, staticPrivateKey, fixedEphemeralPrivateKey),
    writeHandshake: (handle, payload) =>
      invoke(IPC.noiseCall, 'writeHandshake', handle, payload),
    readHandshake: (handle, message) =>
      invoke(IPC.noiseCall, 'readHandshake', handle, message),
    getRemoteStaticKey: (handle) => invoke(IPC.noiseCall, 'getRemoteStaticKey', handle),
    finishHandshake: (handle, maxRecordSize) =>
      invoke(IPC.noiseCall, 'finishHandshake', handle, maxRecordSize),
    destroyHandshake: (handle) => invoke(IPC.noiseCall, 'destroyHandshake', handle),
    shouldRotateSession: (handle, nextPayloadLength) =>
      invoke(IPC.noiseCall, 'shouldRotateSession', handle, nextPayloadLength),
    seal: (handle, type, payload) => invoke(IPC.noiseCall, 'seal', handle, type, payload),
    open: (handle, record) => invoke(IPC.noiseCall, 'open', handle, record),
    destroySession: (handle) => invoke(IPC.noiseCall, 'destroySession', handle),
  },
  dialogs: {
    confirm: (options) => invoke(IPC.dialogConfirm, options),
    notify: (options) => invoke(IPC.dialogNotify, options),
    pickDocument: (mimeType) => invoke(IPC.dialogPickDocument, mimeType),
    saveFile: (sourceUri, suggestedName) =>
      invoke(IPC.dialogSaveFile, sourceUri, suggestedName),
    saveMedia: (sourceUri) => invoke(IPC.dialogSaveMedia, sourceUri),
    shareFile: (sourceUri, suggestedName) =>
      invoke(IPC.dialogShareFile, sourceUri, suggestedName),
  },
  image: {
    renderAndSave: (uri, options) => invoke(IPC.imageRender, uri, options),
  },
  zip: {
    create: (sourceUri, targetUri) => invoke(IPC.zipCreate, sourceUri, targetUri),
    extract: (sourceUri, targetUri) => invoke(IPC.zipExtract, sourceUri, targetUri),
    uncompressedSize: (archiveUri) => invoke(IPC.zipUncompressedSize, archiveUri),
    onProgress(listener) {
      zipProgressListeners.add(listener);
      return () => {
        zipProgressListeners.delete(listener);
      };
    },
  },
  notifications: {
    isSupported: () => notificationSupported,
    show: (content) => invoke(IPC.notificationShow, content),
    dismissAll: () => invoke(IPC.notificationDismissAll),
  },
  windowFocus: {
    isFocused: () => windowFocused,
    onChange(listener) {
      windowFocusListeners.add(listener);
      return () => {
        windowFocusListeners.delete(listener);
      };
    },
  },
  deepLink: {
    takePendingUrl: () => invoke(IPC.deepLinkTakePending),
    onAvailable(listener) {
      deepLinkListeners.add(listener);
      return () => deepLinkListeners.delete(listener);
    },
  },
  localAuth: {
    hasEnrolledAuth: () => invoke(IPC.localAuthHasEnrolled),
    authenticate: (reason) => invoke(IPC.localAuthAuthenticate, reason),
  },
  tray: {
    setUnreadCount: (count) => invoke(IPC.traySetUnreadCount, count),
  },
  windowChrome: {
    setTheme: (theme) => invoke(IPC.windowChromeSetTheme, theme),
    setScreenshotPreview: (enabled) => invoke(IPC.windowChromeSetScreenshotPreview, enabled),
  },
  proximity: {
    isAvailable: () => proximityAvailable,
    requestPermissions: () => invoke(IPC.proximityRequestPermissions),
    startAdvertising: (profile) => invoke(IPC.proximityStartAdvertising, profile),
    updateProfile: (profile) => invoke(IPC.proximityUpdateProfile, profile),
    preferPeripheral: (endpointId) => invoke(IPC.proximityPreferPeripheral, endpointId),
    disconnect: (endpointId) => invoke(IPC.proximityDisconnect, endpointId),
    startScan: (scanDurationMs) => invoke(IPC.proximityStartScan, scanDurationMs),
    stopScan: () => invoke(IPC.proximityStopScan),
    stopSession: () => invoke(IPC.proximityStopSession),
    refreshPeerProfile: (endpointId) => invoke(IPC.proximityRefreshPeerProfile, endpointId),
    async send(endpointId, payload) {
      const result = await invoke<{ ok: boolean; error?: string }>(
        IPC.proximitySend,
        endpointId,
        payload,
      );
      if (!result.ok) throw new Error(result.error || 'Nearby send failed');
    },
    onEvent(listener) {
      proximityListeners.add(listener);
      return () => proximityListeners.delete(listener);
    },
  },
  backgroundTask: {
    setRunner(run) {
      ipcRenderer.removeAllListeners(IPC.backgroundRun);
      ipcRenderer.on(IPC.backgroundRun, (_event, runId: string) => {
        void run().finally(() => ipcRenderer.send(IPC.backgroundComplete, runId));
      });
    },
    register: (minimumIntervalMinutes) =>
      invoke(IPC.backgroundRegister, minimumIntervalMinutes),
    unregister: () => invoke(IPC.backgroundUnregister),
  },
  system: {
    openRuntimeNotices: () => invoke(IPC.systemOpenRuntimeNotices),
    openExternalUrl: (url) => invoke(IPC.systemOpenExternal, url),
    platform: process.platform,
  },
};

contextBridge.exposeInMainWorld('psstpsstDesktop', bridge);
