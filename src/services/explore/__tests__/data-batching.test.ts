import { NappData } from '../data';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/local-relay', () => ({ localRelay: { subscribe: () => () => {}, query: async () => [] } }));
jest.mock('@/services/napplet/network', () => ({ relayUrls: (urls: string[]) => urls }));

it('merges authors only on the relays to which they were routed', async () => {
  jest.useFakeTimers();
  const a = 'a'.repeat(64), b = 'b'.repeat(64), target = 'c'.repeat(64), life = new AbortController();
  const query = jest.fn(async (_relays: string[], filters: any[]) => ({ incomplete: false,
    events: filters.flatMap(filter => filter.authors.map((pubkey: string) => ({ id: pubkey, pubkey, kind: 3, created_at: 1, content: '', tags: [['p', target]], sig: '' }))) }));
  const network = { routes: async ([author]: string[]) => author === a ? ['wss://shared.example/', 'wss://only-a.example/'] : ['wss://shared.example/'], query } as unknown as NappletNetwork;
  try {
    const data = new NappData(a, network, life.signal);
    const first = data.list('loadFollowsList', a), second = data.list('loadFollowsList', b);
    await jest.advanceTimersByTimeAsync(8);
    await expect(first).resolves.toMatchObject({ items: [target] });
    await expect(second).resolves.toMatchObject({ items: [target] });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(['wss://shared.example/'], [{ kinds: [3], authors: [a, b], limit: 2 }], life.signal, undefined, 10000);
    expect(query).toHaveBeenCalledWith(['wss://only-a.example/'], [{ kinds: [3], authors: [a], limit: 1 }], life.signal, undefined, 10000);
  } finally { life.abort(); jest.useRealTimers(); }
});
