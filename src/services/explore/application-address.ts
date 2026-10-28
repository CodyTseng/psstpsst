import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { parseNostrEventReference, type NostrEventReference } from '@/lib/nostr/event-reference';
import { parseFavoriteReference } from './favorites-protocol';
import { websiteEntry, type ExploreEntry } from './model';
import { parseApplicationAddressQuery } from './address-query';

const APPLICATION_KINDS = new Set([5129, 15129, 35129, 15128, 35128, 35130]);

export function isApplicationReference(reference: NostrEventReference): boolean {
  return reference.kind !== undefined && APPLICATION_KINDS.has(reference.kind);
}

/** Share previews use the same verified metadata as Explore without adding or visiting apps. */
export function applicationReferenceEntry(reference: NostrEventReference): ExploreEntry | undefined {
  if (!reference.id && !isApplicationReference(reference)) return;
  if (!reference.id && (!reference.author || reference.identifier === undefined)) return;
  try {
    const tag = reference.id
      ? ['e', reference.id, reference.relays[0] ?? '', reference.author ?? '']
      : ['a', `${reference.kind}:${reference.author}:${reference.identifier}`, reference.relays[0] ?? ''];
    return { ...parseFavoriteReference(tag).entry, address: reference.bech32,
      kind: reference.kind === 35130 ? 'napp' : [15128, 35128].includes(reference.kind!) ? 'nsite' : 'napplet' };
  } catch { return; }
}

/** A canonical application address is sufficient to resolve details, regardless of list membership. */
export function applicationEntryFromAddress(value: string): ExploreEntry | undefined {
  if (!value || value.length > 8192) return;
  if (value.startsWith('local~')) return { key: value, address: value, kind: 'napp', title: value,
    description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
  if (/^[a-f0-9]{64}$/.test(value)) return { ...parseFavoriteReference(['e', value]).entry, address: neventEncode({ id: value }) };
  const reference = parseNostrEventReference(value);
  if (reference) return applicationReferenceEntry(reference);
  const query = parseApplicationAddressQuery(value);
  if (query?.type === 'website') {
    const tail = decodeURIComponent(new URL(query.key).pathname.split('/').filter(Boolean).at(-1) ?? '');
    if (/^(?:naddr|nevent|note)1/i.test(tail)) return applicationEntryFromAddress(tail);
    return websiteEntry(query.key);
  }
  if (query?.type === 'naddr') {
    const address = naddrEncode({ kind: query.kind, pubkey: query.author,
      identifier: query.filter['#d']?.[0] ?? '', relays: query.relays });
    return applicationReferenceEntry(parseNostrEventReference(address)!);
  }
}

