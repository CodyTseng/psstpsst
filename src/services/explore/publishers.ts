import { createStore } from 'zustand/vanilla';
import { NappletNetwork } from '@/services/napplet/network';
import { discoveryEntries, discoveryStore, EXPLORE_KINDS, EXPLORE_RELAYS } from './discovery';
import type { ExploreEntry } from './model';
import { isPublicKey as isPublisher } from './lists';
export { isPublisher };

export type PublisherState = { entries: ExploreEntry[]; loading: boolean; loaded: boolean; error: boolean };
const catalogues = new Map<string, ReturnType<typeof createCatalogue>>();

function createCatalogue(pubkey: string) {
  const store = createStore<PublisherState>(() => ({
    entries: discoveryStore.getState().entries.filter(entry => entry.manifest?.pubkey === pubkey),
    loading: false, loaded: false, error: false,
  }));
  let updatedAt = 0;
  let pending: Promise<void> | undefined;
  return {
    store,
    load(account: string, refresh = false): Promise<void> {
      if (pending) return pending;
      if (!refresh && updatedAt && Date.now() - updatedAt < 5 * 60 * 1000) return Promise.resolve();
      store.setState({ loading: true, error: false });
      const request = (async () => {
        let network: NappletNetwork | undefined;
        try {
          network = new NappletNetwork(account);
          const result = await network.query(EXPLORE_RELAYS,
            EXPLORE_KINDS.map(kind => ({ kinds: [kind], authors: [pubkey], limit: 60 })));
          if (result.error) throw new Error(result.error);
          // Relay filters are a request; verify both authorship and signatures locally.
          const entries = await discoveryEntries(result.events.filter(event => event.pubkey === pubkey));
          store.setState({ entries, loaded: true, error: result.incomplete });
          updatedAt = Date.now();
        } catch { store.setState({ error: true }); }
        finally { network?.destroy(); store.setState({ loading: false }); }
      })();
      pending = request;
      void request.finally(() => { if (pending === request) pending = undefined; });
      return request;
    },
  };
}

/** Each public catalogue is bounded to 500 verified entries; retain eight recent publishers. */
export function publisherCatalogue(pubkey: string) {
  if (!isPublisher(pubkey)) throw new Error('invalid-publisher');
  const existing = catalogues.get(pubkey);
  if (existing) {
    catalogues.delete(pubkey); catalogues.set(pubkey, existing);
    return existing;
  }
  if (catalogues.size >= 8) catalogues.delete(catalogues.keys().next().value!);
  const catalogue = createCatalogue(pubkey);
  catalogues.set(pubkey, catalogue);
  return catalogue;
}
