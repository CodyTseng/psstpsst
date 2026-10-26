import { clearApplicationTestCache } from '../testing/memory-cache';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { naddrEncode } from 'nostr-tools/nip19';
import { parseApplicationAddressQuery, resolveApplicationAddress } from '../address-search';
import { parseSite, websiteEntry } from '../model';
import { readEntries } from '../repository';
import { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/nostr/event-cache-retention', () => ({ pruneEventCache: jest.fn(async () => {}), favoriteCoordinates: '' }));
jest.mock('@/services/relay/replaceable-events.service', () => jest.requireActual('../testing/memory-cache').replaceableCache);
jest.mock('@/services/nostr/cached-events.service', () => jest.requireActual('../testing/memory-cache').immutableCache);
jest.mock('../repository', () => ({ readEntries: jest.fn() }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
const secret = generateSecretKey(), author = getPublicKey(secret);
const pointer = (kind = 35130, relays: string[] = [], identifier = kind < 30000 ? '' : 'app') =>
  naddrEncode({ kind, pubkey: author, identifier, relays });
const manifest = (kind = 35130, created_at = 1, identifier = 'app') => finalizeEvent({ kind, created_at, content: 'Application',
  tags: [...(kind >= 30000 ? [['d', identifier]] : []),
    ...([15129, 35129].includes(kind) ? [['x', 'a'.repeat(64)]] : [['path', '/index.html', 'a'.repeat(64)]]),
    ['title', 'App'], ['server', 'https://media.example/']] }, secret);
const query = jest.fn(), routes = jest.fn(), destroy = jest.fn(), mediaServers = jest.fn();
const target = (kind = 35130, relays: string[] = []) => parseApplicationAddressQuery(pointer(kind, relays))!;
const signal = () => new AbortController().signal;
beforeEach(() => {
  clearApplicationTestCache();
  jest.clearAllMocks();
  jest.mocked(readEntries).mockResolvedValue([]);
  query.mockReset().mockResolvedValue({ events: [manifest()], incomplete: false });
  routes.mockReset().mockResolvedValue(['wss://write.example/']);
  mediaServers.mockReset().mockResolvedValue([]);
  jest.mocked(NappletNetwork).mockImplementation(() => ({ query, routes, destroy, mediaServers }) as unknown as NappletNetwork);
});

it('distinguishes keywords, URLs, Nostr URIs and naddr share URLs', () => {
  expect(parseApplicationAddressQuery('photo albums')).toBeNull();
  expect(parseApplicationAddressQuery('https://EXAMPLE.com/path?q=1#section')).toEqual({ type: 'website', key: 'https://example.com/path?q=1#section' });
  expect(parseApplicationAddressQuery('example.com/path')).toEqual({ type: 'website', key: 'https://example.com/path' });
  expect(parseApplicationAddressQuery(`nostr:${pointer()}`)).toEqual(target());
  expect(parseApplicationAddressQuery(`https://jumble.social/${pointer()}`)).toEqual(target());
  expect(parseApplicationAddressQuery(pointer(30023))?.type).toBe('invalid');
  expect(parseApplicationAddressQuery(pointer(15129, [], 'invalid-root'))?.type).toBe('invalid');
  expect(parseApplicationAddressQuery('naddr1broken')?.type).toBe('invalid');
});

it('returns a canonical in-memory match despite different relay hints without reading the database or relay', async () => {
  const app = parseSite(manifest());
  expect(await resolveApplicationAddress('account', target(35130, ['wss://hint.example']), [app], signal())).toMatchObject({ key: app.key, manifest: app.manifest });
  expect(readEntries).not.toHaveBeenCalled();
  expect(NappletNetwork).not.toHaveBeenCalled();
});

it('reads a locally saved application before querying relays', async () => {
  const app = parseSite(manifest());
  jest.mocked(readEntries).mockResolvedValue([app]);
  expect(await resolveApplicationAddress('account', target(), [], signal())).toMatchObject(app);
  expect(readEntries).toHaveBeenCalledWith('account', app.key);
  expect(NappletNetwork).not.toHaveBeenCalled();
});

it('queries only naddr relay hints and never falls back when they return no application', async () => {
  query.mockResolvedValue({ events: [], incomplete: false });
  await expect(resolveApplicationAddress('account', target(35130, ['wss://hint.example']), [], signal())).rejects.toThrow('napplets.not_found');
  expect(query).toHaveBeenCalledWith(['wss://hint.example/'], [{ kinds: [35130], authors: [author], '#d': ['app'], limit: 1 }], expect.anything());
  expect(routes).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledTimes(1);
});

it.each([
  [35130, ['wss://relay.nostrapps.com/']],
  [35129, ['wss://relay.napplet.soy/']],
  [15129, ['wss://relay.napplet.soy/']],
  [35128, ['wss://relay.nsite.lol/', 'wss://relay.nosto.re/']],
  [15128, ['wss://relay.nsite.lol/', 'wss://relay.nosto.re/']],
] as const)('uses write relays plus only the dedicated sources for kind %s when hints are absent', async (kind, dedicated) => {
  query.mockResolvedValue({ events: [manifest(kind)], incomplete: false });
  const result = await resolveApplicationAddress('account', target(kind), [], signal());
  expect(result.manifest?.kind).toBe(kind);
  expect(routes).toHaveBeenCalledWith([author], 'write', true, expect.anything());
  expect(query.mock.calls[0][0]).toEqual(['wss://write.example/', ...dedicated]);
  expect(query.mock.calls[0][1][0]).toEqual({ kinds: [kind], authors: [author], ...(kind >= 30000 ? { '#d': ['app'] } : {}), limit: 1 });
});

it('uses only dedicated relays when no author write relays are available', async () => {
  routes.mockRejectedValue(new Error('recipient-relays-unavailable'));
  await resolveApplicationAddress('account', target(), [], signal());
  expect(query.mock.calls[0][0]).toEqual(['wss://relay.nostrapps.com/']);
});

it('rejects signed events for a different application and forged manifests', async () => {
  const valid = manifest();
  query.mockResolvedValue({ events: [manifest(35130, 2, 'other-app'), { ...valid, content: 'forged' }], incomplete: false });
  await expect(resolveApplicationAddress('account', target(), [], signal())).rejects.toThrow('napplets.invalid_manifest');
});

it('constructs a website result without inventing a publisher or relay lookup', async () => {
  const address = parseApplicationAddressQuery('https://example.com/path')!;
  expect(await resolveApplicationAddress('account', address, [], signal())).toEqual(websiteEntry('https://example.com/path'));
  expect(NappletNetwork).not.toHaveBeenCalled();
});

it('discards a late relay result after cancellation and destroys its transport', async () => {
  let finish!: (result: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = resolveApplicationAddress('account', target(35130, ['wss://hint.example']), [], controller.signal);
  for (let i = 0; i < 10 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 0));
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  finish({ events: [manifest()], incomplete: false });
  await rejected;
  expect(destroy).toHaveBeenCalled();
});

it.each([
  ['example.com', 'https://example.com/'],
  ['WWW.Example.com:8443/path?q=1#section', 'https://www.example.com:8443/path?q=1#section'],
  ['例子.中国/路径', new URL('https://例子.中国/路径').href],
  ['xn--fsqu00a.xn--fiqs8s', 'https://xn--fsqu00a.xn--fiqs8s/'],
])('recognizes browser-style domain input %s with HTTPS by default', (input, expected) => {
  expect(parseApplicationAddressQuery(input)).toEqual({ type: 'website', key: expected });
});

it.each(['photo albums', 'search.example notes', 'user@example.com', 'https://', 'http://'])(
  'does not resolve %s as a website', input => {
    expect(parseApplicationAddressQuery(input)?.type).not.toBe('website');
  },
);
