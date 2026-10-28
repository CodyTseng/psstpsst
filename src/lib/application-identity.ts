import { normalizeEventKey } from './nostr/event-key';

/** Window identity ignores Nostr relay hints and keeps website shortcut URLs distinct. */
export function applicationSourceId(address: string): string {
  if (/^local~[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(address)) return address;
  const value = address.trim().replace(/^nostr:/i, '');
  if (!/^https?:\/\//i.test(value)) return normalizeEventKey(value);
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-application-address');
  return url.href;
}
export const applicationInstanceKey = (account: string, sourceId: string) => JSON.stringify([account, sourceId]);
