import type { Event } from 'nostr-tools';
import type { NappletNetwork } from '@/services/napplet/network';

export const APPLICATION_CATALOGUE_SOURCES = [
  { relays: ['wss://relay.nostrapps.com/'], kinds: [35130] },
  { relays: ['wss://relay.napplet.soy/'], kinds: [5129, 15129, 35129] },
  { relays: ['wss://relay.nsite.lol/', 'wss://relay.nosto.re/'], kinds: [15128, 35128] },
];

/** Catalogue membership comes only from each format's dedicated relays. */
export async function queryApplicationCatalogue(network: NappletNetwork, author?: string) {
  const results = await Promise.allSettled(APPLICATION_CATALOGUE_SOURCES.map(async source => network.query(source.relays,
    [{ kinds: source.kinds, limit: 100, ...(author ? { authors: [author] } : {}) }])));
  const events: Event[] = [];
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
      if (APPLICATION_CATALOGUE_SOURCES[i].kinds.includes(event.kind) && (!author || event.pubkey === author)) events.push(event);
    }
  }
  if (!available) throw new Error('catalogue-unavailable');
  return { events, incomplete };
}
