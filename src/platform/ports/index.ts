import type { ImageCachePort } from './image-cache';
import type { AppStatePort } from './app-state';
import type { BundledNoticesPort } from './bundled-notices';
import type { AppUpdatePort } from './app-update';
import type { AudioSessionPort } from './audio-session';
import type { BackgroundTaskPort } from './background-task';
import type { BackgroundMessagingPort } from './background-messaging';
import type { CryptoAcceleratorPort } from './crypto-accelerator';
import type { ConfirmationDialogPort } from './confirmation-dialog';
import type { SqliteDriver } from './database';
import type { DeviceCryptoPort } from './device-crypto';
import type { DeepLinkPort } from './deep-link';
import type { DocumentPickerPort } from './document-picker';
import type { FileSystemPort } from './file-system';
import type { FileDropPort } from './file-drop';
import type { FileSaverPort } from './file-saver';
import type { ImageManipulatorPort } from './image-manipulator';
import type { LocalAuthPort } from './local-auth';
import type { LocalizationPort } from './localization';
import type { MediaLibraryPort } from './media-library';
import type { NetworkStatePort } from './network-state';
import type { NoisePort } from './noise';
import type { NotificationsPort } from './notifications';
import type { ProximityTransportPort } from './proximity-transport';
import type { SecureStoragePort } from './secure-storage';
import type { SharingPort } from './sharing';
import type { UrlOpenerPort } from './url-opener';
import type { UnreadIndicatorPort } from './unread-indicator';
import type { WindowChromePort } from './window-chrome';
import type { VideoThumbnailPort } from './video-thumbnail';
import type { ZipArchivePort } from './zip-archive';

export type { ImageCachePort } from './image-cache';
export type { AppStatePort, AppStateStatus } from './app-state';
export type { BundledNoticesPort } from './bundled-notices';
export type { AppUpdatePort, AppUpdateStatus } from './app-update';
export type { AudioSessionPort } from './audio-session';
export type {
  BackgroundTaskExecution,
  BackgroundTaskPort,
} from './background-task';
export type {
  BackgroundMessagingContent,
  BackgroundMessagingPort,
} from './background-messaging';
export type { CryptoAcceleratorPort } from './crypto-accelerator';
export type {
  ConfirmationDialogOptions,
  ConfirmationDialogPort,
  NoticeDialogOptions,
} from './confirmation-dialog';
export type {
  AsyncSqliteDatabase,
  SqlBindValue,
  SqliteDriver,
  SqliteExecutor,
  SqliteQueryMethod,
} from './database';
export type { DeviceCryptoPort } from './device-crypto';
export type { DeepLinkPort } from './deep-link';
export type { DocumentPickerPort } from './document-picker';
export type {
  DirectoryEntry,
  FileReadHandle,
  FileStat,
  FileSystemPort,
  FileWriteHandle,
  RemoteFileResponse,
} from './file-system';
export type {
  FileDropPort,
  FileDropTargetOptions,
  FileDropTargetSubscription,
  NativeDroppedFile,
} from './file-drop';
export type { FileSaverPort } from './file-saver';
export type {
  ImageEncodeFormat,
  ImageManipulatorPort,
  RenderedImage,
} from './image-manipulator';
export type { LocalAuthPort } from './local-auth';
export type { LocalizationPort } from './localization';
export type { MediaLibraryPort } from './media-library';
export type { NetworkStatePort, NetworkStateSnapshot } from './network-state';
export type {
  NoiseKeyPair,
  NoiseOpenResult,
  NoisePort,
  NoiseRole,
  NoiseSession,
} from './noise';
export type { NotificationsPort } from './notifications';
export type {
  ProximityTransportPort,
  ProximityTransportSubscription,
} from './proximity-transport';
export type { SecureStoragePort } from './secure-storage';
export type { SharingPort } from './sharing';
export type { UrlOpenerPort } from './url-opener';
export type { UnreadIndicatorPort } from './unread-indicator';
export type { WindowChromePort, WindowChromeTheme } from './window-chrome';
export type { VideoThumbnailPort } from './video-thumbnail';
export type { ZipArchivePort, ZipArchiveSubscription } from './zip-archive';

/**
 * The full set of platform adapters. One implementation per port; the Expo set
 * (`platform/expo/`) is the default, a future desktop shell provides its own.
 */
export interface PlatformAdapters {
  bundledNotices: BundledNoticesPort;
  appUpdate: AppUpdatePort;
  confirmationDialog: ConfirmationDialogPort;
  secureStorage: SecureStoragePort;
  notifications: NotificationsPort;
  backgroundTask: BackgroundTaskPort;
  backgroundMessaging: BackgroundMessagingPort;
  database: SqliteDriver;
  fileSystem: FileSystemPort;
  imageCache: ImageCachePort;
  fileDrop: FileDropPort;
  fileSaver: FileSaverPort;
  proximityTransport: ProximityTransportPort;
  cryptoAccelerator: CryptoAcceleratorPort;
  deviceCrypto: DeviceCryptoPort;
  deepLink: DeepLinkPort;
  zipArchive: ZipArchivePort;
  localAuth: LocalAuthPort;
  mediaLibrary: MediaLibraryPort;
  sharing: SharingPort;
  networkState: NetworkStatePort;
  noise: NoisePort;
  imageManipulator: ImageManipulatorPort;
  documentPicker: DocumentPickerPort;
  appState: AppStatePort;
  urlOpener: UrlOpenerPort;
  localization: LocalizationPort;
  audioSession: AudioSessionPort;
  unreadIndicator: UnreadIndicatorPort;
  windowChrome: WindowChromePort;
  videoThumbnail: VideoThumbnailPort;
}
