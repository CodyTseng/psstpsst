/**
 * Port for saving media into the OS photo/video library (the camera roll) —
 * used by `services/files/media-save.service.ts`.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 */
export interface MediaLibraryPort {
  /**
   * Request write-only ("add only") permission — all that saving requires.
   * Resolves to the final granted state.
   */
  requestWritePermission(): Promise<boolean>;
  /** Save a local image/video file. False means a desktop Save As was cancelled. */
  saveToLibrary(uri: string): Promise<boolean>;
}
