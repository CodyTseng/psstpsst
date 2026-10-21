import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { parseFavoriteReference } from '../favorites-protocol';
import { resolveFavoriteMetadata } from '../favorite-metadata';
import { cacheFavoriteMetadata, readEntries } from '../repository';
import { subscribeFavoritesChanged } from '../favorites-events';
import { NappletNetwork } from '@/services/napplet/network';
import { websiteEntry } from '../model';
jest.mock('../repository', () => ({ cacheFavoriteMetadata: jest.fn(async () => {}), readEntries: jest.fn(async () => []) }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
const secret = generateSecretKey(), author = getPublicKey(secret);
const query = jest.fn(), routes = jest.fn(), destroy = jest.fn(), mediaServers = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); query.mockReset(); routes.mockResolvedValue(['wss://write.example/']); mediaServers.mockResolvedValue([]);
  jest.mocked(readEntries).mockResolvedValue([]);
  jest.mocked(NappletNetwork).mockImplementation(() => ({ query, routes, destroy, mediaServers }) as unknown as NappletNetwork);
});
it('does no metadata work for ordinary websites', async () => {
  const app = websiteEntry('https://example.com/');
  expect(await resolveFavoriteMetadata('account', app, new AbortController().signal)).toBe(app);
  expect(NappletNetwork).not.toHaveBeenCalled(); expect(cacheFavoriteMetadata).not.toHaveBeenCalled();
});
it('verifies and caches one hinted application without changing membership or recency', async () => {
  const event = finalizeEvent({ kind: 35130, created_at: 1, content: '', tags: [['d', 'notes'], ['title', 'Notes'], ['path', '/index.html', 'a'.repeat(64)]] }, secret);
  query.mockResolvedValue({ events: [event] });
  const app = { ...parseFavoriteReference(['a', `35130:${author}:notes`, 'wss://hint.example/']).entry, desktopPosition: 2, lastUsedAt: 100 };
  const changed = jest.fn(), unsubscribe = subscribeFavoritesChanged(changed);
  try {
    const resolved = await resolveFavoriteMetadata('account', app, new AbortController().signal);
    expect(resolved).toMatchObject({ key: app.key, title: 'Notes', desktopPosition: 2, lastUsedAt: 100 });
    expect(query.mock.calls[0][0]).toEqual(['wss://hint.example/']); expect(routes).not.toHaveBeenCalled();
    expect(cacheFavoriteMetadata).toHaveBeenCalledWith('account', expect.objectContaining({ manifest: event }));
    expect(changed).toHaveBeenCalledWith('account', app.key);
  } finally { unsubscribe(); }
});
it('resolves immutable kind-5129 favorites by exact event id', async () => {
  const event = finalizeEvent({ kind: 5129, created_at: 1, content: 'A small application', tags: [['x', 'a'.repeat(64)], ['title', 'Mini']] }, secret);
  query.mockResolvedValue({ events: [event] });
  const app = parseFavoriteReference(['e', event.id, '', author]).entry;
  const resolved = await resolveFavoriteMetadata('account', app, new AbortController().signal);
  expect(resolved.release?.event.id).toBe(event.id);
  expect(query.mock.calls[0][1]).toEqual([{ ids: [event.id], kinds: [5129], limit: 1 }]);
});
it('leaves unavailable or aborted favorites intact without persisting an unverified manifest', async () => {
  query.mockResolvedValue({ events: [], error: true });
  const app = parseFavoriteReference(['a', `35130:${author}:missing`]).entry;
  await expect(resolveFavoriteMetadata('account', app, new AbortController().signal)).rejects.toThrow('napplets.request_failed');
  const life = new AbortController(); life.abort();
  await expect(resolveFavoriteMetadata('account', app, life.signal)).rejects.toThrow();
  expect(cacheFavoriteMetadata).not.toHaveBeenCalled();
});
