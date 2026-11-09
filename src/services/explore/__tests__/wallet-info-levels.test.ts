import type { RuntimePrompt } from '@/services/napplet/runtime';
import { authorizeWalletInfo } from '../wallet-info-permission';
import { SigningPermissions } from '@/services/signing/permissions';
import { levels, rules } from '@/services/signing/testing/memory-repository';
import { readBrowserPermissions } from '../browser-permission-store';

jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/signing/repository', () => jest.requireActual('../../signing/testing/memory-repository').memoryRepository);
jest.mock('../browser-permission-store', () => ({ readBrowserPermissions: jest.fn(async () => []), saveBrowserPermissions: jest.fn() }));
const scope = { accountPubkey: 'account', sourceId: 'https://site.example' };
let life: AbortController;
beforeEach(() => { jest.clearAllMocks(); levels.clear(); rules.clear(); levels.set(JSON.stringify(scope), undefined); life = new AbortController(); });
afterEach(() => life.abort());

it('shares the level selected by a wallet information read with the next NIP-07 call', async () => {
  const choose = jest.fn(async () => 'trusted');
  const confirmSigning = jest.fn(async () => 'allow');
  const permissions = new SigningPermissions(scope, confirmSigning, life.signal, () => {}, choose);
  const confirmInfo = jest.fn<Promise<string | false>, [RuntimePrompt, AbortSignal]>(async () => 'routine');
  (await authorizeWalletInfo(scope, 'Site', life.signal, confirmInfo))();
  await permissions.authorizeAccess('get-public-key');
  expect(confirmInfo).toHaveBeenCalledTimes(1);
  expect(confirmInfo.mock.calls[0][0]).toMatchObject({ appAuthorizationLevel: true });
  expect(choose).not.toHaveBeenCalled();
  expect(confirmSigning).not.toHaveBeenCalled();
});
it('shares a Manual level selected by NIP-07 while retaining the wallet information review', async () => {
  const choose = jest.fn(async () => 'manual');
  const permissions = new SigningPermissions(scope, async () => 'allow', life.signal, () => {}, choose);
  await permissions.authorizeAccess('get-public-key');
  const confirmInfo = jest.fn<Promise<string | false>, [RuntimePrompt, AbortSignal]>(async () => 'allow');
  (await authorizeWalletInfo(scope, 'Site', life.signal, confirmInfo))();
  expect(choose).toHaveBeenCalledTimes(1);
  expect(confirmInfo).toHaveBeenCalledTimes(1);
  expect(confirmInfo.mock.calls[0][0]).toMatchObject({ walletAccess: true });
  expect(readBrowserPermissions).toHaveBeenCalledWith(scope, 'webln-info');
});
it('serializes concurrent NIP-07 and wallet first-use requests without duplicate level selection', async () => {
  const choose = jest.fn(async () => 'routine');
  const permissions = new SigningPermissions(scope, async () => 'allow', life.signal, () => {}, choose);
  const confirmInfo = jest.fn<Promise<string | false>, [RuntimePrompt, AbortSignal]>(async () => 'routine');
  const [, check] = await Promise.all([permissions.authorizeAccess('get-public-key'), authorizeWalletInfo(scope, 'Site', life.signal, confirmInfo)]);
  check();
  expect(choose).toHaveBeenCalledTimes(1);
  expect(confirmInfo).not.toHaveBeenCalled();
});
