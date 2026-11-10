import { nip19, type Event, type EventTemplate } from 'nostr-tools';
import { CommonActions } from '../common';
import type { ApplicationNetwork } from '@/services/applications/network';
import { PublicIdentityData } from '@/services/applications/public-identity';

jest.mock('@/services/local-relay', () => ({ localRelay: { subscribe: () => () => {}, query: async () => [] } }));

const account = 'a'.repeat(64), first = 'b'.repeat(64), second = 'c'.repeat(64), eventId = 'd'.repeat(64);
const relay = 'wss://relay.example/';
const current = () => {};
const clients: CommonActions[] = [];
const lifetimes: AbortController[] = [];
function fixture(owner = account) {
  const network = {
    accountPubkey: owner,
    replaceable: jest.fn(async () => null as Event | null),
    routes: jest.fn(async () => [relay]),
    query: jest.fn(async () => ({ events: [] as Event[], incomplete: false, error: undefined as string | undefined })),
  };
  let sequence = 0;
  const publish = jest.fn(async (template: EventTemplate) => ({ ok: true, eventId: String(++sequence), event: { ...template, id: String(sequence), pubkey: owner, sig: '' } as Event }));
  const life = new AbortController(); lifetimes.push(life);
  const identity = new PublicIdentityData(network as unknown as ApplicationNetwork, life.signal);
  const actions = new CommonActions({ account: owner, network: network as unknown as ApplicationNetwork, identity, publish });
  clients.push(actions);
  return { actions, network, publish };
}
afterEach(() => { clients.splice(0).forEach(client => client.close()); lifetimes.splice(0).forEach(life => life.abort()); });

it.each([
  { type: 'npub', hex: first }, { type: 'note', hex: eventId },
  { type: 'nprofile', pubkey: first, relays: [relay] },
  { type: 'nevent', eventId, author: first, kind: 1, relays: [relay] },
  { type: 'naddr', identifier: 'article', pubkey: first, kind: 30023, relays: [relay] },
  { type: 'nrelay', relay },
])('round trips public NIP-19 $type without signer access', async input => {
  const { actions, publish } = fixture();
  const encoded = await actions.handle('encodeNip19', { input }, current);
  const decoded = await actions.handle('decodeNip19', { value: encoded.value }, current);
  expect(encoded).toMatchObject({ ok: true, nip19Type: input.type });
  const { type, ...fields } = input;
  expect(decoded).toMatchObject({ ...fields, ok: true, nip19Type: type });
  expect(publish).not.toHaveBeenCalled();
});

it('rejects secret and malformed identifiers before signer or network access', async () => {
  const { actions, network, publish } = fixture();
  await expect(actions.handle('decodeNip19', { value: nip19.nsecEncode(new Uint8Array(32).fill(1)) }, current)).rejects.toThrow();
  await expect(actions.handle('encodeNip19', { input: { type: 'nsec', hex: first } }, current)).rejects.toThrow();
  await expect(actions.handle('getProfile', { target: nip19.noteEncode(eventId) }, current)).rejects.toThrow();
  expect(network.replaceable).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});

it.each([first, nip19.npubEncode(first), nip19.nprofileEncode({ pubkey: first })])('resolves a profile target %s and preserves its signed event', async target => {
  const { actions, network } = fixture();
  const event = { kind: 0, pubkey: first, content: JSON.stringify({ name: 'Alice', display_name: 'Alice B' }), tags: [] } as unknown as Event;
  network.query.mockResolvedValue({ events: [event], incomplete: false, error: undefined });
  expect(await actions.handle('getProfile', { target }, current)).toEqual({ ok: true, pubkey: first, profile: { name: 'Alice', display_name: 'Alice B', displayName: 'Alice B' }, result: { event } });
  expect(network.routes).toHaveBeenCalledWith([first], 'write', false, expect.anything());
});

it('returns absent profiles and normalizes public follows from account write relays without signer access', async () => {
  const { actions, network, publish } = fixture();
  expect(await actions.handle('getProfile', { target: first }, current)).toEqual({ ok: true, pubkey: first, profile: null });
  network.query.mockResolvedValue({ events: [{ kind: 3, pubkey: account, tags: [['p', first.toUpperCase()], ['p', first], ['p', 'bad'], ['t', 'topic']] } as Event], incomplete: false, error: undefined });
  expect(await actions.handle('follows', {}, current)).toEqual({ ok: true, pubkeys: [first] });
  expect(network.routes).toHaveBeenCalledWith([account], 'write', false, expect.anything());
  expect(network.query).toHaveBeenCalledWith([relay], [{ kinds: [3], authors: [account], limit: 1 }], expect.anything());
  expect(network.replaceable).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it('serializes sibling-runtime follows, preserves content and tag metadata, and applies unfollows', async () => {
  const one = fixture(), two = fixture();
  const previous = { kind: 3, id: eventId, pubkey: account, created_at: 1, content: 'legacy relay metadata', tags: [['p', first, relay, 'friend'], ['t', 'topic']] } as Event;
  one.network.query.mockResolvedValue({ events: [previous], incomplete: false, error: undefined });
  two.network.query.mockResolvedValue({ events: [previous], incomplete: false, error: undefined });
  await Promise.all([
    one.actions.handle('follow', { pubkeys: [nip19.npubEncode(second)] }, current),
    two.actions.handle('unfollow', { pubkeys: [nip19.npubEncode(first)] }, current),
  ]);
  expect(one.publish.mock.calls[0][0]).toMatchObject({ kind: 3, content: previous.content, tags: [...previous.tags, ['p', second]] });
  expect(two.publish.mock.calls[0][0]).toMatchObject({ kind: 3, content: previous.content, tags: [['t', 'topic'], ['p', second]] });
  expect(two.publish.mock.calls[0][0].created_at).toBeGreaterThan(one.publish.mock.calls[0][0].created_at);
  expect((await two.actions.handle('follows', {}, current)).pubkeys).toEqual([second]);
});

it('does not carry follow state across accounts or publish after an incomplete read', async () => {
  const one = fixture(), two = fixture(first);
  await one.actions.handle('follow', { pubkeys: [second] }, current);
  expect((await two.actions.handle('follows', {}, current)).pubkeys).toEqual([]);
  two.network.query.mockResolvedValue({ events: [], incomplete: true, error: 'network-error' });
  await expect(two.actions.handle('follow', { pubkeys: [second] }, current)).rejects.toThrow('network-error');
  expect(two.publish).not.toHaveBeenCalled();
});

it('constructs native and addressable NIP-25 reactions including custom emoji', async () => {
  const { actions, network, publish } = fixture();
  network.query.mockResolvedValue({ events: [{ id: eventId, pubkey: first, kind: 30023, tags: [['d', 'article']] } as Event], incomplete: false, error: undefined });
  await actions.handle('react', { targetEventId: eventId, reaction: ':wave:', customEmojiHref: 'https://example.com/wave.png' }, current);
  expect(publish.mock.calls[0][0]).toMatchObject({ kind: 7, content: ':wave:', tags: [['e', eventId, '', first], ['p', first], ['k', '30023'], ['a', `30023:${first}:article`], ['emoji', 'wave', 'https://example.com/wave.png']] });
});

it('constructs NIP-56 profile reports and resolves missing authors for event reports', async () => {
  const { actions, network, publish } = fixture();
  await actions.handle('report', { target: { type: 'pubkey', pubkey: nip19.npubEncode(first) }, reason: 'spam', text: 'Spam' }, current);
  expect(publish.mock.calls[0][0]).toMatchObject({ kind: 1984, content: 'Spam', tags: [['p', first, 'spam']] });
  network.query.mockResolvedValue({ events: [{ id: eventId, pubkey: first } as Event], incomplete: false, error: undefined });
  await actions.handle('report', { target: { type: 'event', id: eventId }, reason: 'illegal', text: '' }, current);
  expect(publish.mock.calls[1][0]).toMatchObject({ kind: 1984, tags: [['e', eventId, 'illegal'], ['p', first]] });
});

it.each([
  ['follow', { pubkeys: [] }], ['unfollow', { pubkeys: ['invalid'] }],
  ['react', { targetEventId: 'bad', reaction: '+' }],
  ['report', { target: { type: 'pubkey', pubkey: first }, reason: 'invalid', text: '' }],
])('rejects malformed %s requests before publication', async (op, message) => {
  const { actions, publish } = fixture();
  await expect(actions.handle(op as string, message as Record<string, unknown>, current)).rejects.toThrow();
  expect(publish).not.toHaveBeenCalled();
});

it('does not present a completely failed follow publication as the current follow list', async () => {
  const { actions, publish } = fixture();
  publish.mockResolvedValueOnce({ ok: false, eventId, event: { id: eventId, kind: 3, pubkey: account, created_at: 1, tags: [['p', first]], content: '', sig: '' } });
  const result = await actions.handle('follow', { pubkeys: [first] }, current);
  expect(result.ok).toBe(false);
  expect((await actions.handle('follows', {}, current)).pubkeys).toEqual([]);
});
