import { createStore } from 'zustand/vanilla';
import type { Event } from 'nostr-tools';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { NappletNetwork } from '@/services/napplet/network';
import { MARKET_RELAYS, parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';

export const EXPLORE_RELAYS = [...new Set([...DISCOVERY_RELAYS, MARKET_RELAYS[0]])];
export const EXPLORE_KINDS = [5129, 15129, 35129, 35130, 15128, 35128];
export const discoveryStore = createStore(() => ({
  entries: [] as ExploreEntry[], loading: false, loaded: false, error: false,
}));
let updatedAt = 0;
let pending: Promise<void> | undefined;

/** Verify bounded relay results without blocking a frame with a batch of signatures. */
export async function discoveryEntries(events: Event[]): Promise<ExploreEntry[]> {
  const entries = new Map<string, ExploreEntry>();
  for (let i = 0; i < Math.min(events.length, 500); i++) {
    if (i % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      const event = events[i];
      const app = [5129, 15129, 35129].includes(event.kind)
        ? fromNapplet(parseManifest(event)) : parseSite(event);
      const previous = entries.get(app.key)?.manifest;
      if (!previous || event.created_at > previous.created_at ||
        (event.created_at === previous.created_at && event.id < previous.id)) entries.set(app.key, app);
    } catch { /* Ignore unsupported or invalid public manifests. */ }
  }
  return [...entries.values()].sort((a, b) => b.manifest!.created_at - a.manifest!.created_at || a.key.localeCompare(b.key));
}

export function discoverApplications(account: string, refresh = false): Promise<void> {
  if (pending) return pending;
  if (!refresh && updatedAt > 0 && Date.now() - updatedAt < 5 * 60 * 1000) return Promise.resolve();
  discoveryStore.setState({ loading: true, error: false });
  pending = (async () => {
    // Public catalogue queries never authenticate or write to the local event database.
    const network = new NappletNetwork(account);
    try {
      const result = await network.query(EXPLORE_RELAYS, EXPLORE_KINDS.map(kind => ({ kinds: [kind], limit: 60 })));
      if (result.error) throw new Error(result.error);
      const entries = await discoveryEntries(result.events);
      discoveryStore.setState({ entries, loaded: true, error: result.incomplete });
      updatedAt = Date.now();
    } catch {
      discoveryStore.setState({ error: true });
    } finally {
      network.destroy();
      discoveryStore.setState({ loading: false });
      pending = undefined;
    }
  })();
  return pending;
}
