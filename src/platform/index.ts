import type { PlatformAdapters } from './ports';
import { getPlatform } from './registry';

export type {
  ClipboardPort,
  AppStatePort,
  AppStateStatus,
  AppUpdatePort,
  AppUpdateStatus,
  AsyncSqliteDatabase,
  AudioSessionPort,
  BackgroundMessagingContent,
  BackgroundMessagingPort,
  BackgroundTaskExecution,
  BackgroundTaskPort,
  BundledNoticesPort,
  ConfirmationDialogOptions,
  ConfirmationDialogPort,
  CryptoAcceleratorPort,
  DeviceCryptoPort,
  DeepLinkPort,
  DirectoryEntry,
  DocumentPickerPort,
  FileReadHandle,
  FileDropPort,
  FileDropTargetOptions,
  FileDropTargetSubscription,
  FileStat,
  FileSystemPort,
  FileWriteHandle,
  RemoteFileResponse,
  ImageCachePort,
  ImageEncodeFormat,
  ImageManipulatorPort,
  LocalizationPort,
  MediaLibraryPort,
  NetworkStatePort,
  NetworkStateSnapshot,
  NoiseKeyPair,
  NoiseOpenResult,
  NoisePort,
  NoiseRole,
  NoiseSession,
  NoticeDialogOptions,
  NativeDroppedFile,
  NotificationsPort,
  PushDevice,
  PushNotificationsPort,
  PlatformAdapters,
  ProximityTransportPort,
  ProximityTransportSubscription,
  RenderedImage,
  ScreenOrientationPort,
  SecurityPort,
  SharingPort,
  UrlOpenerPort,
  UnreadIndicatorPort,
  VideoThumbnailPort,
  ZipArchivePort,
  ZipArchiveSubscription,
} from './ports';
export { initPlatformAdapters } from './registry';

/**
 * The platform ports — the only supported way for core layers (`services/`,
 * `db/`, `lib/`, `stores/`) to reach OS capabilities. Each property access is
 * resolved lazily through the registry, so a custom adapter set installed via
 * `initPlatformAdapters` at bootstrap takes effect even for modules that
 * imported `platform` earlier.
 *
 * Ports are async-first by contract: I/O methods return promises on every
 * runtime, leaving room for a future out-of-process desktop backend without
 * changing call sites.
 */
export const platform = new Proxy({} as Omit<PlatformAdapters, 'keyVault'>, {
  get(_target, prop: string) {
    if (prop === 'keyVault') throw new Error('Use a signer capability; vault transport is internal');
    if (prop === 'secureStorage') throw new Error('Raw credential storage is private; use a security operation');
    return getPlatform()[prop as keyof PlatformAdapters];
  },
});
