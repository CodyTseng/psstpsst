import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { platform } from '@/platform';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { resolveFavoriteMetadata } from '../favorite-metadata';
import { applicationEntryFromAddress } from '../application-address';
import { openApplicationWindow, readApplicationWindowLaunch } from '../windows';

jest.mock('@/platform', () => ({ platform: { napplet: { windows: { open: jest.fn(), launch: jest.fn(), resolveIdentity: jest.fn(async () => true) } } } }));
jest.mock('@/services/account/account-receive-guard', () => ({ canReceiveForAccount: jest.fn(async () => true) }));
jest.mock('@/services/napplet/lifecycle', () => ({ registerNappletLifecycle: jest.fn() }));
jest.mock('../application-tasks', () => ({ applicationTasks: {} }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(), setData: jest.fn() }));
jest.mock('../favorite-metadata', () => ({ resolveFavoriteMetadata: jest.fn(async (_account, entry) => entry) }));

const accountPubkey = 'a'.repeat(64);
beforeEach(() => { jest.clearAllMocks(); });

it.each([35130, 35128, 35129, 5129])('opens a kind-%s reference before metadata lookup and resolves it in the destination', async kind => {
  const address = kind === 5129 ? neventEncode({ id: 'b'.repeat(64), kind, author: accountPubkey, relays: ['wss://hint.example'] })
    : naddrEncode({ kind, pubkey: accountPubkey, identifier: 'test', relays: ['wss://hint.example'] });
  const entry = applicationEntryFromAddress(address)!;
  await openApplicationWindow(entry, accountPubkey, ['network']);
  expect(resolveFavoriteMetadata).not.toHaveBeenCalled();
  const launch = jest.mocked(platform.napplet.windows!.open).mock.calls[0][0];
  expect(launch).toMatchObject({ accountPubkey, address, reviewedRequired: ['network'] });
  jest.mocked(platform.napplet.windows!.launch).mockResolvedValueOnce(launch);
  const result = await readApplicationWindowLaunch();
  expect(result).toMatchObject({ accountPubkey, entry: { key: entry.key, address, kind: entry.kind }, reviewedRequired: ['network'] });
  expect(resolveFavoriteMetadata).toHaveBeenCalledWith(accountPubkey, expect.objectContaining({ key: entry.key, address }), expect.any(AbortSignal));
});

it('preserves website launch handling', async () => {
  const address = 'https://site.example/path';
  jest.mocked(platform.napplet.windows!.launch).mockResolvedValueOnce({ accountPubkey, address });
  expect(await readApplicationWindowLaunch()).toMatchObject({ accountPubkey, entry: { kind: 'website', address } });
});

it.each(['naddr1invalid', 'nevent1invalid', naddrEncode({ kind: 35130, pubkey: accountPubkey, identifier: 'notes' })])('preserves explicit website paths ending with %s', async suffix => {
  const address = `https://site.example/${suffix}`;
  jest.mocked(platform.napplet.windows!.launch).mockResolvedValueOnce({ accountPubkey, address });
  expect(await readApplicationWindowLaunch()).toMatchObject({ entry: { key: address, address, kind: 'website' } });
  expect(platform.napplet.windows!.resolveIdentity).not.toHaveBeenCalled();
});

it('reconciles a verified event reference with the native window registry', async () => {
  const address = neventEncode({ id: 'b'.repeat(64), kind: 35130 });
  const manifest = { id: 'b'.repeat(64) } as NonNullable<ReturnType<typeof applicationEntryFromAddress>>['manifest'];
  const resolved = { ...applicationEntryFromAddress(naddrEncode({ kind: 35130, pubkey: accountPubkey, identifier: 'notes' }))!, manifest };
  jest.mocked(platform.napplet.windows!.launch).mockResolvedValueOnce({ accountPubkey, address });
  jest.mocked(resolveFavoriteMetadata).mockResolvedValueOnce(resolved);
  expect(await readApplicationWindowLaunch()).toMatchObject({ entry: resolved });
  expect(platform.napplet.windows!.resolveIdentity).toHaveBeenCalledWith(manifest);
});

it('rejects unavailable accounts before creating a window', async () => {
  jest.mocked(canReceiveForAccount).mockResolvedValueOnce(false);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(openApplicationWindow(applicationEntryFromAddress('https://site.example')!, accountPubkey)).rejects.toThrow('account-unavailable');
    expect(platform.napplet.windows!.open).not.toHaveBeenCalled();
    expect(resolveFavoriteMetadata).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});
