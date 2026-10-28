import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { eventKeyAddress, normalizeEventKey } from '@/lib/nostr/event-key';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { publicUrl } from '@/services/napplet/protocol';
import { websiteEntry, type ExploreEntry } from './model';

export const KIND_APP_FAVORITES = 30267;
export const FAVORITES_D = 'psstpsst-favorites';
export const MAX_FAVORITES = 512;
const KINDS = new Set([15128, 35128, 15129, 35129, 35130]);
const hexKey = (value: string) => /^[a-f0-9]{64}$/.test(value);
export type FavoriteReference = { entry: ExploreEntry; tag: string[] };

/** Stable identities and optional relay hints; no cached artwork or permission grants. */
export function favoriteReference(entry: Pick<ExploreEntry, 'address' | 'kind' | 'manifest'>): string[] {
  if (entry.kind === 'website') return ['r', entry.address];
  const ref = parseNostrEventReference(entry.address) ?? parseNostrEventReference(eventKeyAddress(entry.address));
  const relay = ref?.relays[0];
  if (entry.manifest?.kind === 5129 || ref?.id) {
    const id = entry.manifest?.id ?? ref?.id;
    if (!id || !hexKey(id)) throw new Error('invalid-favorite');
    const author = entry.manifest?.pubkey ?? ref?.author;
    return ['e', id, ...(relay || author ? [relay ?? ''] : []), ...(author ? [author] : [])];
  }
  if (!ref || ref.identifier === undefined || !ref.author || !ref.kind || !KINDS.has(ref.kind)) throw new Error('invalid-favorite');
  return ['a', `${ref.kind}:${ref.author}:${ref.identifier}`, ...(relay ? [relay] : [])];
}

export function parseFavoriteReference(tag: string[]): FavoriteReference {
  if (tag[0] === 'r' && tag.length === 2 && tag[1].length <= 8192) {
    const entry = websiteEntry(tag[1]);
    return { entry, tag: ['r', entry.address] };
  }
  const relay = tag[2] ? publicUrl(tag[2], true) : undefined;
  if (tag[0] === 'e' && tag.length <= 4 && hexKey(tag[1] ?? '') && (!tag[3] || hexKey(tag[3]))) {
    const key = tag[1];
    return { tag, entry: { key, address: neventEncode({ id: tag[1], kind: 5129, author: tag[3] || undefined, relays: relay ? [relay] : [] }),
      title: tag[1].slice(0, 12), kind: 'napplet', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null } };
  }
  if (tag[0] !== 'a' || tag.length > 3) throw new Error('invalid-favorite');
  const [rawKind, author, ...identifier] = tag[1].split(':');
  const kind = Number(rawKind), d = identifier.join(':');
  if (!KINDS.has(kind) || String(kind) !== rawKind || !hexKey(author) || !identifier.length ||
      (kind < 30000 ? d !== '' : !d) || d.length > 2000) throw new Error('invalid-favorite');
  const pointer = { kind, pubkey: author, identifier: d };
  return { tag, entry: { key: normalizeEventKey(`${kind}:${author}:${d}`), address: naddrEncode({ ...pointer, relays: relay ? [relay] : [] }),
    title: d || author.slice(0, 12), kind: kind === 35130 ? 'napp' : [15129, 35129].includes(kind) ? 'napplet' : 'nsite',
    description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null } };
}

/** An invalid/unsupported snapshot never clears an existing local collection. */
export function parseFavoriteSnapshot(plaintext: string): FavoriteReference[] {
  if (plaintext.length > 1024 * 1024) throw new Error('favorites-too-large');
  const tags: unknown = JSON.parse(plaintext);
  if (!Array.isArray(tags) || tags.length > MAX_FAVORITES) throw new Error('invalid-favorites');
  const result: FavoriteReference[] = [], seen = new Set<string>();
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2 || !tag.every(value => typeof value === 'string')) throw new Error('invalid-favorite');
    const item = parseFavoriteReference(tag);
    if (!seen.has(item.entry.key)) { seen.add(item.entry.key); result.push(item); }
  }
  return result;
}
