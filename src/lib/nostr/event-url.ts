import type { NostrEventReference } from './event-reference';

export const DEFAULT_NOSTR_EVENT_URL = 'https://jumble.social/{id}';
export const NOSTR_EVENT_URL_PREFERENCE_KEY = 'chat.nostrEventUrl';

const NON_APP_SCHEMES = new Set([
  'javascript:', 'vbscript:', 'data:', 'file:', 'blob:', 'about:',
  'app:', 'psstpsst:', 'psstpsst-file:',
]);

/** Accept web and app URL templates, including opaque links such as `nostr:{id}`. */
export function normalizeNostrEventUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return DEFAULT_NOSTR_EVENT_URL;
  if (!value.includes('{id}')) return null;
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  const scheme = value.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1].toLowerCase();
  if (!scheme || scheme.length === 2 || NON_APP_SCHEMES.has(scheme)) return null;
  const withoutPlaceholder = value.replaceAll('{id}', '');
  if (/[{}]/.test(withoutPlaceholder)) return null;

  try {
    const url = new URL(value.replaceAll('{id}', 'note1example'));
    if (url.username || url.password) return null;
    const isWebUrl = scheme === 'http:' || scheme === 'https:';
    if (isWebUrl) {
      if (!/^https?:\/\//i.test(value) || !url.hostname) return null;
      // Web identifiers cannot change the destination host. App links may put
      // the identifier immediately after `://`, where URL calls it the host.
      const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
      if (!authority || authority.includes('{id}')) return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** The template is validated when the preference is loaded or saved. */
export function nostrEventUrl(reference: NostrEventReference, template: string): string {
  return template.replaceAll('{id}', reference.bech32);
}
