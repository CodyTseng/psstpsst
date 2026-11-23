import type { EventTemplate } from 'nostr-tools';

import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { fetchReplaceable, parseRelayListMetadata } from './relay-router';
import { getReplaceableEvent, storeReplaceableEvent } from './replaceable-events.service';

/** Merge the write edit with the freshest available read declaration. */
export async function prepareWriteRelayConfiguration(
  accountPubkey: string, urls: string[], editedAt: number,
): Promise<{ template: EventTemplate; previousEventId: string | null }> {
  const write = Array.from(new Set(urls.map(normalizeRelayUrl)));
  if (!write.length) throw new Error('At least one write relay is required.');
  const key = { pubkey: accountPubkey, kind: 10002 };
  const cached = await getReplaceableEvent(key);
  const confirmedMissRelays = [
    ...DISCOVERY_RELAYS.map(normalizeRelayUrl),
    ...(cached ? parseRelayListMetadata(cached).write : []),
  ];
  const targets = [...new Set([...confirmedMissRelays, ...write])];
  const remote = await fetchReplaceable(targets, key.kind, key.pubkey, { confirmedMissRelays });
  if (remote) await storeReplaceableEvent(remote);
  const current = await getReplaceableEvent(key);
  const tags: string[][] = [];
  const writeSet = new Set(write);
  const readSeen = new Set<string>();
  const previousRead = current ? parseRelayListMetadata(current).read : [];
  const previousReadSet = new Set(previousRead);
  const combinedOrder = [...previousRead.filter(url => writeSet.has(url)), ...write.filter(url => !previousReadSet.has(url))];
  // Use separate role tags when shared tags would change either list's order.
  const combineRoles = combinedOrder.every((url, index) => url === write[index]);
  for (const tag of current?.tags ?? []) {
    if (tag[0] !== 'r' || !tag[1]) {
      tags.push(tag);
    } else if (tag[2] === undefined || tag[2] === '' || tag[2] === 'read') {
      let url: string;
      try { url = normalizeRelayUrl(tag[1]); } catch {
        tags.push(tag[2] === 'read' ? tag : ['r', tag[1], 'read', ...tag.slice(3)]);
        continue;
      }
      if (readSeen.has(url)) continue;
      readSeen.add(url);
      const extensions = tag.slice(3);
      // Keep the role slot empty when extension fields follow a shared relay.
      tags.push(combineRoles && writeSet.has(url)
        ? ['r', url, ...(extensions.length > 0 ? ['', ...extensions] : [])]
        : ['r', url, 'read', ...extensions]);
    } else if (tag[2] !== 'write') {
      tags.push(tag);
    }
  }
  for (const url of write) {
    if (!combineRoles || !readSeen.has(url)) tags.push(['r', url, 'write']);
  }
  return {
    template: { kind: key.kind, tags, content: current?.content ?? '', created_at: editedAt },
    previousEventId: current?.id ?? null,
  };
}
