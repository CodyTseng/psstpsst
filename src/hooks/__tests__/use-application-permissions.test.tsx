import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useNappletPermissions } from '../use-napplet-permissions';
import { useBrowserPermissions } from '../use-browser-permissions';
import { readPermissions } from '@/services/signing/management';
import { readBrowserPermissions } from '@/services/explore/browser-permission-store';
import type { SigningSnapshot } from '@/services/signing/model';

jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
// Opening Explore permissions must not require an activated Napplet runtime.
jest.mock('@/stores/napplet.store', () => ({ useNappletPermissionRevision: () => 0 }));
jest.mock('@/services/napplet/service', () => ({ nappletService: {} }));
jest.mock('@/services/signing/management', () => ({ readPermissions: jest.fn() }));
jest.mock('@/services/explore/browser-permission-store', () => ({ readBrowserPermissions: jest.fn() }));
jest.mock('@/services/signing/changes', () => ({ subscribeSigning: jest.fn(() => () => {}) }));

let renderer: ReactTestRenderer;
let signing: ReturnType<typeof useNappletPermissions>;
let browser: ReturnType<typeof useBrowserPermissions>;
function Probe({ account, sourceId = 'https://site.example' }: { account: string; sourceId?: string }) {
  const signingValue = useNappletPermissions(account, undefined, true, sourceId);
  const browserValue = useBrowserPermissions(account, sourceId);
  useEffect(() => { signing = signingValue; browser = browserValue; }, [signingValue, browserValue]);
  return null;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readPermissions).mockResolvedValue({ rules: [], activity: [] });
  jest.mocked(readBrowserPermissions).mockResolvedValue([]);
});
afterEach(() => act(() => renderer.unmount()));

it('resolves both local permission sections using the page account without a runtime', async () => {
  await act(async () => { renderer = create(<Probe account="accountA" />); });
  const scope = { accountPubkey: 'accountA', sourceId: 'https://site.example' };
  expect(readPermissions).toHaveBeenCalledWith(scope);
  expect(readBrowserPermissions).toHaveBeenCalledWith(scope);
  expect(signing.data).toEqual({ rules: [], activity: [] });
  expect(browser?.rules).toEqual([]);
});

it('ignores an old account read after the page account changes', async () => {
  let finish!: (snapshot: SigningSnapshot) => void;
  jest.mocked(readPermissions).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { renderer = create(<Probe account="accountA" />); });
  expect(signing.data).toBeUndefined();
  await act(async () => { renderer.update(<Probe account="accountB" />); });
  const current = signing.data;
  await act(async () => { finish({ rules: [], activity: [{ at: 1, decision: 'allowed', scope: { operation: 'publish', kind: 1 } }] }); });
  expect(signing.data).toBe(current);
  expect(readPermissions).toHaveBeenLastCalledWith({ accountPubkey: 'accountB', sourceId: 'https://site.example' });
  expect(readBrowserPermissions).toHaveBeenLastCalledWith({ accountPubkey: 'accountB', sourceId: 'https://site.example' });
});

it('settles failed local reads as errors', async () => {
  jest.mocked(readPermissions).mockRejectedValueOnce(new Error('database-unavailable'));
  jest.mocked(readBrowserPermissions).mockRejectedValueOnce(new Error('database-unavailable'));
  await act(async () => { renderer = create(<Probe account="accountA" />); });
  expect(signing.error).toBe(true);
  expect(browser?.error).toBe(true);
});
