/**
 * Port for exporting a local file to a user-selected destination.
 *
 * Desktop adapters present Save As. Mobile adapters hand the file to the
 * system document destination picker. A false result means the user cancelled
 * or the platform has no destination picker.
 */
export interface FileSaverPort {
  save(
    uri: string,
    options: { suggestedName: string; mimeType?: string },
  ): Promise<boolean>;
}
