import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { platform } from '@/platform';
import { useExploreShare } from '../use-explore-share';
import { useApplicationWindowActions } from '../use-application-window-actions';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import type { ExploreEntry } from '@/services/explore/model';
import type { ApplicationWindowAction } from '@/platform/ports/application-window';

const mockStart = jest.fn();
jest.mock('@/stores/forward-draft.store', () => ({ useForwardDraftStore: { getState: () => ({ start: mockStart }) } }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: { getState: () => ({ status: 'ready', activePubkey: 'account' }) } }));
jest.mock('@/services/explore/service', () => ({ exploreService: {} }));
jest.mock('@/services/explore/application-presence', () => ({ applicationPresence: { observeWindows: () => () => {} } }));
jest.mock('@/services/explore/visits', () => ({ subscribeExploreVisits: jest.fn() }));
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

let renderer: ReactTestRenderer;
let share: ReturnType<typeof useExploreShare>;
const entry = { kind: 'napp', title: 'Never include this title', address: 'naddr1example' } as ExploreEntry;
function Harness({ account = 'account' }: { account?: string | null }) {
  const action = useExploreShare(account);
  useEffect(() => { share = action; }, [action]);
  useApplicationWindowActions();
  return null;
}
beforeEach(() => { jest.clearAllMocks(); platform.napplet.windows = undefined; });
afterEach(() => { act(() => renderer?.unmount()); });

it('shares only the Nostr link without a title or surrounding text', () => {
  act(() => { renderer = create(<Harness />); });
  act(() => share(entry));
  expect(mockStart).toHaveBeenCalledWith({ accountPubkey: 'account', sourceConversationKey: null,
    messages: [{ kind: KIND_CHAT, content: 'nostr:naddr1example', tags: [] }] });
  expect(router.push).toHaveBeenCalledWith('/forward');
});

it('shares only the website URL for unsigned websites', () => {
  act(() => { renderer = create(<Harness />); });
  act(() => share({ ...entry, kind: 'website', address: 'https://example.com/path' }));
  expect(mockStart.mock.calls[0][0].messages[0].content).toBe('https://example.com/path');
});

it('does not open forwarding without an account', () => {
  act(() => { renderer = create(<Harness account={null} />); });
  act(() => share(entry));
  expect(mockStart).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('keeps window handoffs link-only when the main window creates the draft', () => {
  let receive!: (action: ApplicationWindowAction) => void;
  const action = jest.fn<Promise<void>, [ApplicationWindowAction]>().mockResolvedValue(undefined);
  platform.napplet.windows = { isHost: true, action, onAction: (listener: typeof receive) => { receive = listener; return () => {}; } } as unknown as NonNullable<typeof platform.napplet.windows>;
  act(() => { renderer = create(<Harness />); });
  act(() => share(entry));
  const sent = action.mock.calls[0][0] as ApplicationWindowAction;
  expect(mockStart).not.toHaveBeenCalled();
  act(() => receive(sent));
  expect(mockStart.mock.calls[0][0].messages[0].content).toBe('nostr:naddr1example');
  expect(router.push).toHaveBeenCalledWith('/forward');
});
