/** Region follows the language, optional extlangs and optional script in BCP-47 tags. */
function regionIndex(subtags: string[]): number {
  let index = 1;
  while (/^[a-z]{3}$/i.test(subtags[index] ?? '')) index += 1;
  if (/^[a-z]{4}$/i.test(subtags[index] ?? '')) index += 1;
  return index;
}

export function localeRegion(languageTag: string): string | null {
  const subtags = languageTag.split('-');
  const candidate = subtags[regionIndex(subtags)] ?? '';
  return /^(?:[a-z]{2}|\d{3})$/i.test(candidate) ? candidate.toUpperCase() : null;
}

/** Replace only the BCP-47 region, retaining scripts, variants and extensions.
 * Hermes does not implement Intl.Locale, so this operates on the OS-provided tag.
 */
export function withLocaleRegion(languageTag: string, region: string | null): string {
  if (!region || !/^(?:[a-z]{2}|\d{3})$/i.test(region)) return languageTag;
  const subtags = languageTag.split('-');
  const index = regionIndex(subtags);
  if (/^(?:[a-z]{2}|\d{3})$/i.test(subtags[index] ?? '')) {
    subtags[index] = region.toUpperCase();
  } else {
    subtags.splice(index, 0, region.toUpperCase());
  }
  return subtags.join('-');
}

/** Explicit language regions win; otherwise the device supplies regional conventions. */
export function formattingLocale(language: string, systemLocale: string): string {
  return localeRegion(language) ? language : withLocaleRegion(language, localeRegion(systemLocale));
}
