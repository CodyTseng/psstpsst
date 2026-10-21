import type { Filter } from 'nostr-tools';
import { naddrEncode } from 'nostr-tools/nip19';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { publicUrl } from '@/services/napplet/protocol';
import { websiteAddress, type ExploreEntry } from './model';

export type ApplicationAddressQuery =
  | { type: 'invalid'; key: string }
  | { type: 'website'; key: string }
  | { type: 'naddr'; key: string; kind: number; author: string; relays: string[]; filter: Filter };

/** Keywords stay local; explicit addresses and share-link URLs select an exact application. */
export function parseApplicationAddressQuery(value: string): ApplicationAddressQuery | null {
  const input = value.trim();
  const isNaddr = /^(?:nostr:)?naddr1/i.test(input);
  const isUrl = /^(?:https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$))/i.test(input);
  if (!isNaddr && !isUrl) return null;
  if (input.length > 8192) return { type: 'invalid', key: input };
  try {
    let code = input;
    if (isUrl) {
      const url = new URL(websiteAddress(input));
      const tail = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
      if (!/^naddr1/i.test(tail)) return { type: 'website', key: url.href };
      code = tail;
    }
    const ref = parseNostrEventReference(code);
    if (!ref || ref.identifier === undefined || !ref.author || !ref.kind ||
      ![15128, 35128, 15129, 35129, 35130].includes(ref.kind) ||
      (ref.kind < 30000 && ref.identifier !== '') || (ref.kind >= 30000 && !ref.identifier)) throw new Error('invalid-address');
    return { type: 'naddr', key: naddrEncode({ kind: ref.kind, pubkey: ref.author, identifier: ref.identifier }),
      kind: ref.kind, author: ref.author, relays: ref.relays.map(relay => publicUrl(relay, true)).slice(0, 4),
      filter: { kinds: [ref.kind], authors: [ref.author], ...(ref.kind >= 30000 ? { '#d': [ref.identifier] } : {}) } };
  } catch { return { type: 'invalid', key: input }; }
}

export function findApplicationAddress(query: ApplicationAddressQuery | null, entries: readonly ExploreEntry[]) {
  if (!query || query.type === 'invalid') return undefined;
  let found: ExploreEntry | undefined;
  for (const entry of entries) {
    if (entry.key !== query.key) continue;
    if (!found || (entry.manifest?.created_at ?? 0) > (found.manifest?.created_at ?? 0) ||
      (entry.manifest?.created_at === found.manifest?.created_at && (entry.manifest?.id ?? '') < (found.manifest?.id ?? ''))) found = entry;
  }
  return found;
}

