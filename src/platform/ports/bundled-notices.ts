/** Read an immutable notice by its generated content identifier, never a path or URL. */
export interface BundledNoticesPort {
  readText(id: string): Promise<string>;
  /** Open the installed desktop runtime's original Chromium notice document. */
  openRuntimeNotices(): Promise<void>;
}
