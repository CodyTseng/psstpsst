import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { assertNotAborted } from '@/platform/abort';
import { NappletNetwork } from '@/services/napplet/network';
import { parseManifest } from '@/services/napplet/protocol';
import { APPLICATION_CATALOGUE_SOURCES } from './catalogue-relays';
import { parseApplicationAddressQuery, resolveApplicationAddress } from './address-search';
import { fromNapplet, type ExploreEntry } from './model';
import { cacheFavoriteMetadata } from './repository';
import { notifyFavoritesChanged } from './favorites-events';

export function needsFavoriteMetadata(entry: ExploreEntry) { return entry.kind !== 'website' && !entry.manifest; }

/** A synced reference stays saved if its publisher is unavailable; only verified manifests launch. */
export async function resolveFavoriteMetadata(account: string, entry: ExploreEntry, signal: AbortSignal): Promise<ExploreEntry> {
  if (!needsFavoriteMetadata(entry)) return entry;
  assertNotAborted(signal);
  let resolved: ExploreEntry;
  const query = parseApplicationAddressQuery(entry.address);
  if (query?.type === 'naddr') resolved = await resolveApplicationAddress(account, query, [], signal);
  else {
    const ref = parseNostrEventReference(entry.address);
    if (!ref?.id) throw new Error('napplets.invalid_manifest');
    const network = new NappletNetwork(account);
    const abort = () => network.destroy();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const relays = ref.relays.length ? ref.relays : [...(ref.author ? await network.routes([ref.author], 'write', true, signal).catch(() => []) : []),
        ...APPLICATION_CATALOGUE_SOURCES.filter(source => source.kinds.includes(5129)).flatMap(source => source.relays)];
      assertNotAborted(signal);
      const result = await network.query([...new Set(relays)], [{ ids: [ref.id], kinds: [5129], limit: 1 }], signal);
      assertNotAborted(signal);
      const event = result.events.find(event => event.id === ref.id && event.kind === 5129 && (!ref.author || ref.author === event.pubkey));
      if (!event) throw new Error(result.error || result.incomplete ? 'napplets.request_failed' : 'napplets.not_found');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      assertNotAborted(signal);
      resolved = fromNapplet(parseManifest(event));
      if (!resolved.servers.length) {
        resolved.servers = await network.mediaServers(event.pubkey, signal).catch(() => []);
        if (resolved.release) resolved.release = { ...resolved.release, servers: resolved.servers };
      }
    } finally { signal.removeEventListener('abort', abort); network.destroy(); }
  }
  assertNotAborted(signal);
  if (resolved.key !== entry.key) throw new Error('napplets.invalid_manifest');
  await cacheFavoriteMetadata(account, resolved);
  assertNotAborted(signal);
  notifyFavoritesChanged(account, resolved.key);
  return { ...resolved, desktopPosition: entry.desktopPosition, lastUsedAt: entry.lastUsedAt };
}
