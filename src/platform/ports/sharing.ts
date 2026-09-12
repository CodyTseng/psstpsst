/**
 * Port for the OS share sheet — handing a local file off to other apps. Used
 * by the chat-archive export (`services/dm/dm-backup-storage.ts`).
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 */
export interface SharingPort {
  /** Whether sharing is available on this device/runtime at all. */
  isAvailable(): Promise<boolean>;
  /**
   * Open the share sheet for a local file URI. `mimeType`/`uti` describe the
   * payload to the OS; `dialogTitle` titles the sheet where the OS supports
   * it.
   */
  share(
    uri: string,
    options?: { mimeType?: string; dialogTitle?: string; uti?: string },
  ): Promise<void>;
}
