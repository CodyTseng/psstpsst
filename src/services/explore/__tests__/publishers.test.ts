import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { NappletNetwork } from '@/services/napplet/network';
import { discoveryEntries, discoveryStore } from '../discovery';
import { publisherCatalogue } from '../publishers';

jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
let secret: Uint8Array;
let publisher: string;
const query = jest.fn();
const destroy = jest.fn();
const manifest = (created_at = 1, signer = secret) => finalizeEvent({ kind: 35130, created_at, content: '',
  tags: [['d', 'app'], ['path', '/index.html', 'a'.repeat(64)]] }, signer);

beforeEach(() => {
  secret = generateSecretKey(); publisher = getPublicKey(secret);
  query.mockReset().mockResolvedValue({ events: [], incomplete: false }); destroy.mockClear();
  jest.mocked(NappletNetwork).mockClear().mockImplementation(() => ({ query, destroy }) as unknown as NappletNetwork);
  discoveryStore.setState({ entries: [] });
});

it('queries all supported manifest kinds with an exact publisher filter and verifies relay results', async () => {
  const older = manifest(), latest = manifest(2), unrelated = manifest(3, generateSecretKey());
  query.mockResolvedValue({ events: [older, latest, unrelated, { ...latest, content: 'forged' }], incomplete: false });
  const catalogue = publisherCatalogue(publisher);
  await catalogue.load('account');
  expect(query.mock.calls).toEqual([
    [['wss://relay.nostrapps.com/'], [{ kinds: [35130], authors: [publisher], limit: 100 }]],
    [['wss://relay.napplet.soy/'], [{ kinds: [5129, 15129, 35129], authors: [publisher], limit: 100 }]],
    [['wss://relay.nsite.lol/', 'wss://relay.nosto.re/'], [{ kinds: [15128, 35128], authors: [publisher], limit: 100 }]],
  ]);
  expect(catalogue.store.getState()).toMatchObject({ loaded: true, loading: false, error: false });
  expect(catalogue.store.getState().entries.map(entry => entry.manifest?.id)).toEqual([latest.id]);
  expect(discoveryStore.getState().entries).toEqual([]);
  expect(destroy).toHaveBeenCalledTimes(1);
});

it('shares in-flight queries and caches results when returning from application details', async () => {
  let finish!: (result: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const catalogue = publisherCatalogue(publisher);
  const pending = catalogue.load('account');
  expect(publisherCatalogue(publisher)).toBe(catalogue);
  expect(catalogue.load('account')).toBe(pending);
  finish({ events: [manifest()], incomplete: false });
  await pending;
  await catalogue.load('account');
  expect(query).toHaveBeenCalledTimes(3);
});

it('retains known published applications when refreshing fails', async () => {
  const known = await discoveryEntries([manifest()]);
  discoveryStore.setState({ entries: known });
  query.mockRejectedValue(new Error('offline'));
  const catalogue = publisherCatalogue(publisher);
  await catalogue.load('account');
  expect(catalogue.store.getState()).toMatchObject({ entries: known, loading: false, error: true });
  expect(destroy).toHaveBeenCalledTimes(1);
});

it('keeps separate publishers independent when their requests finish out of order', async () => {
  const otherSecret = generateSecretKey(), other = getPublicKey(otherSecret);
  let finish!: (result: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  query.mockImplementation((_relays, filters) => Promise.resolve({
    events: filters[0].kinds[0] === 35130 ? [manifest(2, otherSecret)] : [], incomplete: false,
  })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = publisherCatalogue(publisher), second = publisherCatalogue(other);
  const pending = first.load('account');
  await second.load('account');
  finish({ events: [manifest()], incomplete: false });
  await pending;
  expect(first.store.getState().entries[0].manifest?.pubkey).toBe(publisher);
  expect(second.store.getState().entries[0].manifest?.pubkey).toBe(other);
});

it.each(['invalid', ['a'.repeat(64)], undefined])('rejects malformed route identifiers before requesting relay data: %j', value => {
  expect(() => publisherCatalogue(value as string)).toThrow('invalid-publisher');
  expect(NappletNetwork).not.toHaveBeenCalled();
});
