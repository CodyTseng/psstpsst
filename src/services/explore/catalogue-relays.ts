import type { Event } from 'nostr-tools';
import type { NappletNetwork } from '@/services/napplet/network';

export const APPLICATION_QUERY_LIMIT = 200;

/** Public directories list updating applications, excluding immutable snapshots. */
export const APPLICATION_DISCOVERY_SOURCES = [
  { relays: ['wss://relay.nostrapps.com/'], kinds: [35130] },
  { relays: ['wss://relay.napplet.soy/'], kinds: [15129, 35129] },
];

export const APPLICATION_CATALOGUE_SOURCES = [
  ...APPLICATION_DISCOVERY_SOURCES,
  { relays: ['wss://relay.nsite.lol/', 'wss://relay.nosto.re/'], kinds: [15128, 35128] },
];

/** Catalogue membership comes only from each format's dedicated relays. */
export async function queryApplicationCatalogue(network: NappletNetwork, author?: string) {
  const results = await Promise.allSettled(APPLICATION_CATALOGUE_SOURCES.map(async source => network.query(source.relays,
    [{ kinds: source.kinds, limit: APPLICATION_QUERY_LIMIT, ...(author ? { authors: [author] } : {}) }])));
  const events: Event[] = [];
  const eventRelays = new Map<string, string[]>();
  let available = false;
  let incomplete = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected' || result.value.error) {
      incomplete = true;
      continue;
    }
    available = true;
    incomplete ||= result.value.incomplete;
    for (const event of result.value.events) {
      if (APPLICATION_CATALOGUE_SOURCES[i].kinds.includes(event.kind) && (!author || event.pubkey === author)) {
        events.push(event);
        const observed = result.value.eventRelays?.get(event.id);
        if (observed?.length) eventRelays.set(event.id, [...new Set([...(eventRelays.get(event.id) ?? []), ...observed])].slice(0, 8));
      }
    }
  }
  if (!available) throw new Error('catalogue-unavailable');
  return { events, incomplete, eventRelays };
}
