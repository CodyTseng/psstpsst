import { matchFilters } from 'nostr-tools';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';
import { assertNotAborted } from '@/platform/abort';
import { NappletNetwork } from '@/services/napplet/network';
import { parseManifest } from '@/services/napplet/protocol';
import { APPLICATION_CATALOGUE_SOURCES } from './catalogue-relays';
import { fromNapplet, parseSite, websiteEntry, type ExploreEntry } from './model';
import { readEntries } from './repository';

import { findApplicationAddress, type ApplicationAddressQuery } from './address-query';

export { findApplicationAddress, parseApplicationAddressQuery } from './address-query';
export type { ApplicationAddressQuery } from './address-query';

export async function resolveApplicationAddress(account: string, query: ApplicationAddressQuery,
  entries: readonly ExploreEntry[], signal: AbortSignal): Promise<ExploreEntry> {
  assertNotAborted(signal);
  if (query.type === 'invalid') throw new Error('napplets.invalid_manifest');
  const cached = findApplicationAddress(query, entries);
  if (cached) return cached;
  const stored = findApplicationAddress(query, await readEntries(account, query.key));
  assertNotAborted(signal);
  if (stored) return stored;
  if (query.type === 'website') return websiteEntry(query.key);
  const network = new NappletNetwork(account);
  try {
    const abort = () => network.destroy();
    signal.addEventListener('abort', abort, { once: true });
    try {
      assertNotAborted(signal);
      let relays = query.relays;
      if (!relays.length) {
        const writes = await network.routes([query.author], 'write', true, signal).catch(error => {
          assertNotAborted(signal);
          if (error instanceof Error && error.message === 'recipient-relays-unavailable') return [];
          throw error;
        });
        assertNotAborted(signal);
        const dedicated = APPLICATION_CATALOGUE_SOURCES.find(source => source.kinds.includes(query.kind))?.relays ?? [];
        relays = normalizeRelayUrls([...writes, ...dedicated]);
      }
      const result = await network.query(relays, [{ ...query.filter, limit: 1 }], signal);
      assertNotAborted(signal);
      const events = result.events.filter(event => matchFilters([query.filter], event))
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      for (let i = 0; i < events.length; i++) {
        if (i % 4 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); assertNotAborted(signal); }
        let app: ExploreEntry;
        try { app = [15129, 35129].includes(query.kind) ? fromNapplet(parseManifest(events[i])) : parseSite(events[i]); }
        catch { continue; }
        if (!app.servers.length) {
          app.servers = await network.mediaServers(query.author, signal).catch(() => []);
          assertNotAborted(signal);
        }
        return app;
      }
      throw new Error(events.length ? 'napplets.invalid_manifest' : result.error || result.incomplete ? 'napplets.request_failed' : 'napplets.not_found');
    } finally { signal.removeEventListener('abort', abort); }
  } finally { network.destroy(); }
}
