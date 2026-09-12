/**
 * Port for creating and extracting ZIP archives — used by the chat-archive
 * export/import (`services/dm/dm-backup.service.ts`). Paths are native
 * filesystem paths (no `file://` scheme); callers strip URIs before calling.
 *
 * Implementations must tolerate the native archiver being absent (a dev
 * client built before the module was added): `isAvailable()` returns false
 * and the caller reports the build as unsupported instead of crashing.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 * Progress reporting is a subscription, so `addProgressListener` is
 * synchronous like the other ports' listener registrations.
 */

/** Handle for a progress subscription; `remove()` detaches the listener. */
export type ZipArchiveSubscription = { remove(): void };

export interface ZipArchivePort {
  /** Whether the native ZIP capability is present at all. */
  isAvailable(): Promise<boolean>;
  /**
   * Create an archive at `targetPath` from the file/directory at
   * `sourcePath`, favoring speed over size (backups are local, transient
   * artifacts).
   */
  zip(sourcePath: string, targetPath: string): Promise<void>;
  /** Extract the archive at `sourcePath` into the directory `targetPath`. */
  unzip(sourcePath: string, targetPath: string): Promise<void>;
  /** Total uncompressed byte size of the archive's entries. */
  getUncompressedSize(archivePath: string): Promise<number>;
  /**
   * Subscribe to the progress (0–1) of the running zip/unzip operation. At
   * most one operation runs at a time; remove the subscription once it
   * completes.
   */
  addProgressListener(listener: (progress: number) => void): ZipArchiveSubscription;
}
