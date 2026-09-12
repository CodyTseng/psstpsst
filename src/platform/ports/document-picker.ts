/**
 * Port for the system document picker — used by the DM backup import
 * (`services/dm/dm-backup.service.ts`) to let the user choose an archive or a
 * legacy message file.
 *
 * Async-first — see the module note in `secure-storage.ts`.
 */
export interface DocumentPickerPort {
  /**
   * Present the picker for a single document of the given mime `type` (the
   * caller passes the wildcard for "any type"). The selected file is staged
   * into the app cache, so the returned uri stays readable after the picker
   * closes. The original display name is preserved for file-type validation.
   * Resolves to null when the user cancels.
   */
  pickDocument(options: { type: string }): Promise<{ uri: string; name: string } | null>;
}
