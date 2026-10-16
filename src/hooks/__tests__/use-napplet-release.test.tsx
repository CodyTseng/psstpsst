import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import { useNappletRelease } from '../use-napplet-release';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';

const app = { key: 'app', hash: 'version', event: { id: 'listing' } } as NappletRelease;
let mockState: { accountPubkey: string; loaded: boolean; installed: NappletRelease[]; market: NappletRelease[] };
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => mockState }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { resolve: jest.fn() } }));
let result: ReturnType<typeof useNappletRelease>;
let renderer: ReactTestRenderer;
function Probe({ id }: { id: string }) {
  const value = useNappletRelease(id);
  useEffect(() => { result = value; }, [value]);
  return null;
}
beforeEach(() => {
  jest.clearAllMocks();
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
