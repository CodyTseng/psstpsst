import catalog from '../src/i18n/native/vault-consent.json';

type Locale = typeof catalog.en;
/** Only a locale selector crosses IPC; approval wording comes from bundled catalogs. */
export function vaultConsent(language: unknown, fallback: string, operation: 'backup' | 'transfer' | 'bunker' | 'walletBinding') {
  const requested = typeof language === 'string' && language.length <= 32 ? language : fallback;
  const lookup = (key: string) => Object.hasOwn(catalog, key) ? (catalog as Record<string, Locale>)[key] : undefined;
  const locale = lookup(requested) ?? lookup(requested.split('-')[0]) ?? catalog.en;
  return { ...locale[operation], cancel: locale.cancel };
}

export function securityCopy(language: unknown, fallback: string) {
  const requested = typeof language === 'string' && language.length <= 32 ? language : fallback;
  const lookup = (key: string) => Object.hasOwn(catalog, key) ? (catalog as Record<string, Locale>)[key] : undefined;
  return lookup(requested) ?? lookup(requested.split('-')[0]) ?? catalog.en;
}
