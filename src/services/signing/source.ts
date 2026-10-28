import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { normalizeEventKey } from '@/lib/nostr/event-key';

/** Canonical addresses exclude relay hints; website origins come from host-verified page URLs. */
export function normalizeSigningSource(value: string): string {
  if (/^local~[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return value;
  const input = value.trim().replace(/^nostr:/i, '');
  if (/^(?:(?:naddr|nevent|note)1|[a-f0-9]{64}$|[0-9]+:)/i.test(input)) return normalizeEventKey(input);
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('invalid-signing-source');
  return url.origin;
}

/** Upgrade the old verified application coordinate while the migration is atomic. */
export function signingSourceFromLegacyKey(key: string): string {
  const [kind, pubkey, ...identifier] = key.split(':');
  if (kind === '5129' && /^[a-f0-9]{64}$/.test(pubkey)) return neventEncode({ id: pubkey });
  if (!['15129', '35129'].includes(kind) || !/^[a-f0-9]{64}$/.test(pubkey)) throw new Error('invalid-signing-source');
  return naddrEncode({ kind: Number(kind), pubkey, identifier: identifier.join(':') });
}
