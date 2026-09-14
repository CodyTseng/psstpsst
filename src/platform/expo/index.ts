import { imageCacheAdapter } from './image-cache';
import type { FileSystemPort } from '../ports/file-system';
import type { FileSaverPort } from '../ports/file-saver';
import type { CryptoAcceleratorPort } from '../ports/crypto-accelerator';
import type { PlatformAdapters } from '../ports';
import type { ProximityTransportPort } from '../ports/proximity-transport';
import type { NoisePort } from '../ports/noise';
import type { SqliteDriver } from '../ports/database';

import { appStateAdapter } from './app-state';
import { bundledNoticesAdapter } from './bundled-notices';
import { appUpdateAdapter } from './app-update';
import { audioSessionAdapter } from './audio-session';
import { backgroundMessagingAdapter } from './background-messaging';
import { backgroundTaskAdapter } from './background-task';
import { confirmationDialogAdapter } from './confirmation-dialog';
import { deviceCryptoAdapter } from './device-crypto';
import { deepLinkAdapter } from './deep-link';
import { documentPickerAdapter } from './document-picker';
import { fileDropAdapter } from './file-drop';
import { imageManipulatorAdapter } from './image-manipulator';
import { localAuthAdapter } from './local-auth';
import { localizationAdapter } from './localization';
import { mediaLibraryAdapter } from './media-library';
import { networkStateAdapter } from './network-state';
import { notificationsAdapter } from './notifications';
import { secureStorageAdapter } from './secure-storage';
import { sharingAdapter } from './sharing';
import { urlOpenerAdapter } from './url-opener';
import { unreadIndicatorAdapter } from './unread-indicator';
import { windowChromeAdapter } from './window-chrome';
import type { VideoThumbnailPort } from '../ports/video-thumbnail';
import { zipArchiveAdapter } from './zip-archive';

/**
 * The database adapter opens the native SQLite handle at module scope, so it is
 * loaded lazily: merely importing the adapter set must not pull in the native
 * module. The first actual database use loads it.
 */
function lazyDatabaseAdapter(): SqliteDriver {
  let real: SqliteDriver | null = null;
  const load = (): SqliteDriver => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./database') as typeof import('./database')).databaseAdapter;
    }
    return real;
  };
  return {
    drizzle: (schema) => load().drizzle(schema),
    execute: (sql, params, method) => load().execute(sql, params, method),
    transaction: (task) => load().transaction(task),
    exec: (sql) => load().exec(sql),
    rawQuery: (sql, params) => load().rawQuery(sql, params),
    rawQueryEach: (sql, params) => load().rawQueryEach(sql, params),
    runBatch: (sql, paramsBatch) => load().runBatch(sql, paramsBatch),
    addChangeListener: (listener) => load().addChangeListener(listener),
  };
}

/** Optional native transports resolve only on first use. */
function lazyProximityTransportAdapter(): ProximityTransportPort {
  let real: ProximityTransportPort | null = null;
  const load = (): ProximityTransportPort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./proximity-transport') as typeof import('./proximity-transport'))
        .proximityTransportAdapter;
    }
    return real;
  };
  return {
    isAvailable: () => load().isAvailable(),
    requestPermissions: () => load().requestPermissions(),
    startAdvertisingAsync: (profile) => load().startAdvertisingAsync(profile),
    updateProfileAsync: (profile) => load().updateProfileAsync(profile),
    preferPeripheralAsync: (endpointId) => load().preferPeripheralAsync(endpointId),
    startScanAsync: (scanDurationMs) => load().startScanAsync(scanDurationMs),
    stopScanAsync: () => load().stopScanAsync(),
    stopSessionAsync: () => load().stopSessionAsync(),
    refreshPeerProfileAsync: (endpointId) => load().refreshPeerProfileAsync(endpointId),
    sendAsync: (endpointId, payload) => load().sendAsync(endpointId, payload),
    addListener: (name, listener) => load().addListener(name, listener),
  };
}

/** The file-system native module also stays behind a lazy adapter boundary. */
function lazyFileSystemAdapter(): FileSystemPort {
  let real: FileSystemPort | null = null;
  const load = (): FileSystemPort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./file-system') as typeof import('./file-system')).fileSystemAdapter;
    }
    return real;
  };
  return {
    documentDirectoryUri: () => load().documentDirectoryUri(),
    cacheDirectoryUri: () => load().cacheDirectoryUri(),
    availableDiskSpace: () => load().availableDiskSpace(),
    stat: (uri) => load().stat(uri),
    makeDirectory: (uri, options) => load().makeDirectory(uri, options),
    listDirectory: (uri) => load().listDirectory(uri),
    readText: (uri) => load().readText(uri),
    readBase64: (uri) => load().readBase64(uri),
    readBytes: (uri) => load().readBytes(uri),
    writeText: (uri, contents) => load().writeText(uri, contents),
    writeBytes: (uri, bytes) => load().writeBytes(uri, bytes),
    openReadHandle: (uri, options) => load().openReadHandle(uri, options),
    openWriteHandle: (uri, options) => load().openWriteHandle(uri, options),
    copy: (fromUri, toUri, options) => load().copy(fromUri, toUri, options),
    move: (fromUri, toUri) => load().move(fromUri, toUri),
    delete: (uri, options) => load().delete(uri, options),
    downloadFile: (url, toUri, options) => load().downloadFile(url, toUri, options),
    requestRemoteFile: (url, options) => load().requestRemoteFile(url, options),
    uploadFile: (url, fileUri, options) => load().uploadFile(url, fileUri, options),
    revealInFolder: (uri) => load().revealInFolder(uri),
  };
}

/** The native destination picker is loaded only when the user chooses Save. */
function lazyFileSaverAdapter(): FileSaverPort {
  let real: FileSaverPort | null = null;
  const load = (): FileSaverPort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./file-saver') as typeof import('./file-saver')).fileSaverAdapter;
    }
    return real;
  };
  return {
    save: (uri, options) => load().save(uri, options),
  };
}

function lazyCryptoAcceleratorAdapter(): CryptoAcceleratorPort {
  let real: CryptoAcceleratorPort | null = null;
  const load = (): CryptoAcceleratorPort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./crypto-accelerator') as typeof import('./crypto-accelerator'))
        .cryptoAcceleratorAdapter;
    }
    return real;
  };
  return {
    isAvailable: () => load().isAvailable(),
    getNip44ConversationKey: (privkeyHex, pubkeyHex) =>
      load().getNip44ConversationKey(privkeyHex, pubkeyHex),
    verifySchnorr: (signatureHex, messageHex, pubkeyHex) =>
      load().verifySchnorr(signatureHex, messageHex, pubkeyHex),
  };
}

/** Video decoding is optional native work and must not load during platform bootstrap. */
function lazyVideoThumbnailAdapter(): VideoThumbnailPort {
  let real: VideoThumbnailPort | null = null;
  const load = (): VideoThumbnailPort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./video-thumbnail') as typeof import('./video-thumbnail'))
        .videoThumbnailAdapter;
    }
    return real;
  };
  return {
    generateThumbhash: (uri) => load().generateThumbhash(uri),
  };
}

function lazyNoiseAdapter(): NoisePort {
  let real: NoisePort | null = null;
  const load = (): NoisePort => {
    if (!real) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = (require('./noise') as typeof import('./noise')).noiseAdapter;
    }
    return real;
  };
  return {
    generateKeyPair: (seed) => load().generateKeyPair(seed),
    createHandshake: (role, staticPrivateKey, fixedEphemeralPrivateKey) =>
      load().createHandshake(role, staticPrivateKey, fixedEphemeralPrivateKey),
    writeHandshake: (handle, payload) => load().writeHandshake(handle, payload),
    readHandshake: (handle, message) => load().readHandshake(handle, message),
    getRemoteStaticKey: (handle) => load().getRemoteStaticKey(handle),
    finishHandshake: (handle, maxRecordSize) =>
      load().finishHandshake(handle, maxRecordSize),
    destroyHandshake: (handle) => load().destroyHandshake(handle),
    shouldRotateSession: (handle, nextPayloadLength) =>
      load().shouldRotateSession(handle, nextPayloadLength),
    seal: (handle, type, payload) => load().seal(handle, type, payload),
    open: (handle, record) => load().open(handle, record),
    destroySession: (handle) => load().destroySession(handle),
  };
}

/** The default adapter set for the Expo runtime. */
export function createExpoAdapters(): PlatformAdapters {
  return {
    bundledNotices: bundledNoticesAdapter,
    appUpdate: appUpdateAdapter,
    confirmationDialog: confirmationDialogAdapter,
    secureStorage: secureStorageAdapter,
    notifications: notificationsAdapter,
    backgroundMessaging: backgroundMessagingAdapter,
    backgroundTask: backgroundTaskAdapter,
    database: lazyDatabaseAdapter(),
    imageCache: imageCacheAdapter,
    fileSystem: lazyFileSystemAdapter(),
    fileDrop: fileDropAdapter,
    fileSaver: lazyFileSaverAdapter(),
    proximityTransport: lazyProximityTransportAdapter(),
    cryptoAccelerator: lazyCryptoAcceleratorAdapter(),
    deviceCrypto: deviceCryptoAdapter,
    deepLink: deepLinkAdapter,
    zipArchive: zipArchiveAdapter,
    localAuth: localAuthAdapter,
    mediaLibrary: mediaLibraryAdapter,
    sharing: sharingAdapter,
    networkState: networkStateAdapter,
    noise: lazyNoiseAdapter(),
    imageManipulator: imageManipulatorAdapter,
    documentPicker: documentPickerAdapter,
    appState: appStateAdapter,
    urlOpener: urlOpenerAdapter,
    localization: localizationAdapter,
    audioSession: audioSessionAdapter,
    unreadIndicator: unreadIndicatorAdapter,
    windowChrome: windowChromeAdapter,
    videoThumbnail: lazyVideoThumbnailAdapter(),
  };
}
