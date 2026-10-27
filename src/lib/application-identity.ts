import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';

/** Window identity ignores Nostr relay hints and keeps website shortcut URLs distinct. */
export function applicationSourceId(address: string): string {
  if (/^local~[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(address)) return address;
  const value = address.replace(/^nostr:/, '');
  if (/^(naddr|nevent)1/i.test(value)) {
    const pointer = decode(value);
    if (pointer.type === 'naddr') return naddrEncode({ kind: pointer.data.kind, pubkey: pointer.data.pubkey, identifier: pointer.data.identifier });
    if (pointer.type === 'nevent') return neventEncode({ id: pointer.data.id });
  }
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-application-address');
  return url.href;
}
export const applicationInstanceKey = (account: string, sourceId: string) => JSON.stringify([account, sourceId]);
