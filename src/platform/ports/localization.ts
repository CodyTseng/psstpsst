/**
 * Port for the device's locale preferences — used by the i18n bootstrap
 * (`i18n/index.ts`) to pick the startup language.
 *
 * Synchronous by exception: the i18n singleton initializes at module scope,
 * before the first frame paints, and the value is a cached OS read, not I/O.
 */
export interface LocalizationPort {
  /**
   * The user's top preferred BCP-47 language tag (e.g. `en-US`, `zh-Hant-TW`),
   * or null when the OS reports no locales.
   */
  preferredLanguageTag(): string | null;
}
