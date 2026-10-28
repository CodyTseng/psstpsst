import { naddrEncode } from 'nostr-tools/nip19';
import { getData, setData } from '@/services/napplet/repository';
import { readApplicationWindowPreference, setApplicationWindowPreference, shouldOpenApplicationWindow } from '../open-preferences';
import type { ExploreKind } from '../model';

let mockSupported = true;
jest.mock('@/platform', () => ({ platform: { napplet: { get tasks() { return mockSupported ? {} : undefined; } } } }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(async () => null), setData: jest.fn(async () => {}) }));

beforeEach(() => { jest.clearAllMocks(); jest.mocked(getData).mockResolvedValue(null); mockSupported = true; });

it.each<[ExploreKind, boolean]>([['napplet', true], ['napp', true], ['nsite', false], ['website', false]])(
  'defaults %s to window=%s without writing a preference', async (kind, expected) => {
    expect(await shouldOpenApplicationWindow({ kind, address: 'https://example.com/page' }, 'account')).toBe(expected);
    expect(setData).not.toHaveBeenCalled();
  },
);

it('keeps individual URL and account choices separate from permission grants', async () => {
  const entry = { kind: 'website' as const, address: 'https://example.com/page?q=one' };
  await setApplicationWindowPreference(entry, 'first', true);
  await setApplicationWindowPreference({ ...entry, address: 'https://example.com/page?q=two' }, 'second', false);
  expect(setData).toHaveBeenNthCalledWith(1, { accountPubkey: 'first', appKey: entry.address }, 'host', 'open-in-window', 'true');
  expect(setData).toHaveBeenNthCalledWith(2, { accountPubkey: 'second', appKey: 'https://example.com/page?q=two' }, 'host', 'open-in-window', 'false');
});

it('ignores relay hints when saving a signed site preference', async () => {
  const pointer = { kind: 35128, pubkey: 'a'.repeat(64), identifier: 'notes' };
  const address = naddrEncode({ ...pointer, relays: ['wss://relay.example'] });
  await setApplicationWindowPreference({ kind: 'nsite', address }, 'account', false);
  expect(setData).toHaveBeenCalledWith({ accountPubkey: 'account', appKey: `35128:${pointer.pubkey}:${pointer.identifier}` }, 'host', 'open-in-window', 'false');
});

it('rereads saved choices on each launch and falls back for invalid values', async () => {
  const entry = { kind: 'website' as const, address: 'https://example.com/' };
  jest.mocked(getData).mockResolvedValueOnce('true').mockResolvedValueOnce('false').mockResolvedValueOnce('invalid');
  expect(await readApplicationWindowPreference(entry, 'account')).toBe(true);
  expect(await readApplicationWindowPreference(entry, 'account')).toBe(false);
  expect(await readApplicationWindowPreference(entry, 'account')).toBe(false);
});

it('leaves unsupported platforms inline without querying preferences', async () => {
  mockSupported = false;
  expect(await shouldOpenApplicationWindow({ kind: 'napp', address: 'https://example.com/' }, 'account')).toBe(false);
  expect(getData).not.toHaveBeenCalled();
});

it.each(['napp', 'napplet'] as const)('ignores old saved %s preferences without reading or writing them', async kind => {
  jest.mocked(getData).mockResolvedValue('false');
  const entry = { kind, address: 'application' };
  expect(await readApplicationWindowPreference(entry, 'account')).toBe(true);
  await setApplicationWindowPreference(entry, 'account', false);
  expect(getData).not.toHaveBeenCalled();
  expect(setData).not.toHaveBeenCalled();
});
