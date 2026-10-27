import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';

/** Canonical addresses exclude relay hints; website origins come from host-verified page URLs. */
export function normalizeSigningSource(value: string): string {
  if (/^local~[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return value;
  const input = value.replace(/^nostr:/, '');
  if (/^(naddr|nevent)1/i.test(input)) {
    const decoded = decode(input);
    if (decoded.type === 'naddr') return naddrEncode({ kind: decoded.data.kind, pubkey: decoded.data.pubkey, identifier: decoded.data.identifier });
    if (decoded.type === 'nevent') return neventEncode({ id: decoded.data.id });
    throw new Error('invalid-signing-source');
  }
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
