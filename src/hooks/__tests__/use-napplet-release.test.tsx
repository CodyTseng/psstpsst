import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import { useNappletRelease } from '../use-napplet-release';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';

let mockAccount = 'accountA';
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: { activePubkey: string }) => unknown) => select({ activePubkey: mockAccount }) }));
const app = { key: 'app', hash: 'version', event: { id: 'listing' } } as NappletRelease;
let mockState: { accountPubkey: string; loaded: boolean; installed: NappletRelease[]; market: NappletRelease[] };
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => mockState }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { resolve: jest.fn(), activate: jest.fn(async () => {}) } }));
let result: ReturnType<typeof useNappletRelease>;
let renderer: ReactTestRenderer;
function Probe({ id }: { id: string }) {
  const value = useNappletRelease(id);
  useEffect(() => { result = value; }, [value]);
  return null;
}
beforeEach(() => {
  jest.clearAllMocks(); mockAccount = 'accountA';
  mockState = { accountPubkey: 'accountA', loaded: true, installed: [], market: [] };
});
afterEach(() => { act(() => renderer?.unmount()); });

it('uses verified local listings in both information and management views', () => {
  mockState.market = [app];
  act(() => { renderer = create(<Probe id="listing" />); });
  expect(result.release).toBe(app);
  expect(nappletService.resolve).not.toHaveBeenCalled();
});

it('discards an old account lookup after switching accounts', async () => {
  let finish!: (release: NappletRelease) => void;
  jest.mocked(nappletService.resolve).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementationOnce(() => new Promise(() => {}));
  act(() => { renderer = create(<Probe id="listing" />); });
  mockAccount = 'accountB';
  mockState = { ...mockState, accountPubkey: 'accountB' };
  act(() => { renderer.update(<Probe id="listing" />); });
  await act(async () => { finish(app); });
  expect(result.accountPubkey).toBe('accountB');
  expect(result.release).toBeUndefined();
});

it('does not carry a resolved release or failure into a different app route', async () => {
  jest.mocked(nappletService.resolve).mockResolvedValueOnce(app).mockRejectedValueOnce(new Error('napplets.not_found'));
  await act(async () => { renderer = create(<Probe id="listing" />); });
  expect(result.release).toBe(app);
  await act(async () => { renderer.update(<Probe id="missing" />); });
  expect(result.release).toBeUndefined();
  expect(result.error).toBe('napplets.not_found');
  mockState = { ...mockState, market: [app] };
  act(() => { renderer.update(<Probe id="listing" />); });
  expect(result.release).toBe(app);
  expect(result.error).toBeUndefined();
});

it('initializes the account only when an app information or permissions view needs it', async () => {
  mockState = { ...mockState, accountPubkey: '', loaded: false };
  await act(async () => { renderer = create(<Probe id="listing" />); });
  expect(nappletService.activate).toHaveBeenCalledWith('accountA');
  expect(nappletService.resolve).not.toHaveBeenCalled();
  jest.mocked(nappletService.resolve).mockResolvedValueOnce(app);
  mockState = { ...mockState, accountPubkey: 'accountA', loaded: true };
  await act(async () => { renderer.update(<Probe id="listing" />); });
  expect(result.release).toBe(app);
});
