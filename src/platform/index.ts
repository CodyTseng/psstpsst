import type { PlatformAdapters } from './ports';
import { getPlatform } from './registry';

export type {
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
  LocalAuthPort,
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
  PlatformAdapters,
  ProximityTransportPort,
  ProximityTransportSubscription,
  RenderedImage,
  SecureStoragePort,
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
export const platform = new Proxy({} as PlatformAdapters, {
  get(_target, prop: string) {
    return getPlatform()[prop as keyof PlatformAdapters];
  },
});
