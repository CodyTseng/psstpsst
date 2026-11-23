import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import { fetchReplaceable, peerMetaRelays } from '../../relay/relay-router';
import { loadCachedReplaceableEvent } from '../../relay/replaceable-events.service';
import { loadSenderMediaServers } from '../media-server.service';

jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/db/schema', () => ({ mediaServerLists: {} }));
jest.mock('../../relay/configuration-publish.service', () => ({}));
jest.mock('../../relay/relay-router', () => ({ fetchReplaceable: jest.fn(), peerMetaRelays: jest.fn() }));
jest.mock('../../relay/replaceable-events.service', () => ({
  loadCachedReplaceableEvent: jest.fn(),
}));

const signer = generateSecretKey();
const sender = getPublicKey(signer);
const tags = [
  ['server', 'https://mirror.example/path/'],
  ['server', 'http://127.0.0.1/'],
  ['server', 'https://MIRROR.example/path'],
  ['server', 'http://user:pass@local.example/'],
  ['server', 'https://last.example/'],
  ['server', 'http://[::1]:8080/'],
];
const event = finalizeEvent({ kind: 10063, tags, created_at: 1, content: '' }, signer);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchReplaceable).mockResolvedValue(event);
  jest.mocked(peerMetaRelays).mockResolvedValue(['wss://outbox.example/', 'ws://127.0.0.1/']);
  jest.mocked(loadCachedReplaceableEvent).mockResolvedValue(event);
});

it('uses the sender coordinate and bounded public peer outboxes plus discovery', async () => {
  jest.mocked(loadCachedReplaceableEvent).mockImplementation(async (key, opts) => {
    const candidates = await (typeof opts.relays === 'function' ? opts.relays(key) : opts.relays);
    expect(candidates).toContain('wss://outbox.example/');
    expect(candidates).toContain('wss://nos.lol/');
    expect(candidates).not.toContain('ws://127.0.0.1/');
    expect(await opts.query!(candidates, [])).toEqual([event]);
    expect(fetchReplaceable).toHaveBeenCalledWith(candidates, 10063, sender);
    return event;
  });
  await expect(loadSenderMediaServers(sender)).resolves.toEqual([
    'https://mirror.example/path', 'http://127.0.0.1/', 'https://last.example/', 'http://[::1]:8080/',
  ]);
  expect(loadCachedReplaceableEvent).toHaveBeenCalledWith({ pubkey: sender, kind: 10063 }, expect.anything());
});

it('does not use default hosts on a cache miss', async () => {
  jest.mocked(loadCachedReplaceableEvent).mockResolvedValueOnce(null);
  await expect(loadSenderMediaServers(sender)).resolves.toEqual([]);
});
