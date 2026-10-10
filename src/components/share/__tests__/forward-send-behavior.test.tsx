import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { forwardNoticeStore } from '@/services/conversation/forward-notice';

let mockActiveAccount = 'account';
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockPrepare = jest.fn();
const mockRun = jest.fn();
const mockReleaseSource = jest.fn();
const mockForward = jest.fn();
const mockSend = jest.fn();
const mockStage = jest.fn();
const mockClear = jest.fn();
const mockToast = jest.fn();
const mockPicker = jest.fn((_props: unknown) => null);
const mockItems = [{ kind: 'text', content: 'shared text' }];
const mockPayloads = [{}];
const mockAddListener = jest.fn(() => () => {});

jest.mock('lucide-react-native/icons/download', () => () => null);

jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: () => mockBack(), replace: (href: string) => mockReplace(href), push: (href: string, options: unknown) => mockPush(href, options) },
  useNavigation: () => ({ addListener: mockAddListener }),
}));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('@/components/navigation/responsive-stack-router', () => ({ PRIMARY_PANE_RESET_MARKER: () => undefined }));
jest.mock('@/services/conversation/incoming-share-send.service', () => ({
  prepareIncomingShareSend: (...args: unknown[]) => mockPrepare(...args),
}));
jest.mock('expo-sharing', () => ({ useIncomingShare: () => ({
  sharedPayloads: mockPayloads, resolvedSharedPayloads: mockPayloads,
  isResolving: false, clearSharedPayloads: mockClear,
}) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: Object.assign(
    (select: (s: unknown) => unknown) => select({ activePubkey: mockActiveAccount }),
    { getState: () => ({ activePubkey: mockActiveAccount }) },
  ),
}));
jest.mock('@/stores/backup-task.store', () => ({
  useBackupTaskStore: (select: (s: unknown) => unknown) => select({ status: 'idle', startImport: jest.fn() }),
}));
jest.mock('@/stores/toast.store', () => ({ showToast: (text: string) => mockToast(text) }));
jest.mock('@/services/conversation/conversation-send.service', () => ({ conversationSendService: {
  forwardMessage: (opts: unknown) => mockForward(opts),
  sendMessage: (opts: unknown) => mockSend(opts),
} }));
jest.mock('@/services/files/incoming-share-file.service', () => ({
  stageIncomingShare: (items: unknown) => mockStage(items),
}));
jest.mock('@/services/account/account.service', () => ({ buildSigner: jest.fn() }));
jest.mock('@/services/dm/incoming-backup', () => ({ incomingBackupCandidate: () => null }));
jest.mock('@/services/dm/rumor-clock', () => ({ nextRumorTimestamp: () => ({ createdAt: 1, millisecond: 1 }) }));
jest.mock('@/lib/share/incoming-share', () => ({
  MAX_INCOMING_SHARE_ITEMS: 10, normalizeIncomingShare: () => mockItems,
}));
jest.mock('@/platform', () => ({ platform: { confirmationDialog: { notify: jest.fn() } } }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({ text: 'black' }) }));
jest.mock('@/components/share/ForwardRecipientScreen', () => ({
  ForwardRecipientScreen: (props: unknown) => mockPicker(props),
}));
jest.mock('@/components/share/ForwardPreview', () => ({ ForwardPreview: () => null }));
jest.mock('@/components/share/IncomingSharePreview', () => ({ IncomingSharePreview: () => null }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));

const { ForwardTargetScreen } = jest.requireActual<typeof import('../ForwardTargetScreen')>('../ForwardTargetScreen');
const { IncomingShareForwardScreen } = jest.requireActual<typeof import('../IncomingShareForwardScreen')>('../IncomingShareForwardScreen');
const target = { conversationKey: 'peer', deliveryKind: 'relay', name: 'Peer' };
let renderer: ReactTestRenderer;
function confirm() {
  const props = mockPicker.mock.lastCall?.[0] as { onConfirm: (targets: unknown[]) => void };
  act(() => props.onConfirm([target]));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockActiveAccount = 'account';
  forwardNoticeStore.setState({ notice: null });
  mockForward.mockResolvedValue({ rumorId: 'rumor' });
  mockSend.mockResolvedValue({ rumorId: 'shared' });
  mockRun.mockResolvedValue(false);
  mockReleaseSource.mockImplementation((cleanup: () => void) => cleanup());
  mockPrepare.mockReturnValue({ run: mockRun, releaseSource: mockReleaseSource });
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.useRealTimers();
});

it('returns to the source and tracks queued forwards without opening the target', async () => {
  const id = useForwardDraftStore.getState().start({
    accountPubkey: 'account', sourceConversationKey: 'source',
    messages: [{ kind: 14, content: 'hello', tags: [] }],
  });
  act(() => { renderer = create(<ForwardTargetScreen />); });
  confirm();
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockForward).not.toHaveBeenCalled();
  expect(forwardNoticeStore.getState().notice).toMatchObject({ id, sourceConversationKey: 'source' });
  await act(async () => { await jest.runAllTimersAsync(); });
  expect(forwardNoticeStore.getState().notice?.targets).toEqual([target]);
  expect(mockToast).not.toHaveBeenCalled();
});

it('keeps queue preparation failures as an exceptional notice', async () => {
  mockForward.mockRejectedValue(new Error('send failed'));
  useForwardDraftStore.getState().start({ accountPubkey: 'account', sourceConversationKey: 'source',
    messages: [{ kind: 14, content: 'hello', tags: [] }] });
  act(() => { renderer = create(<ForwardTargetScreen />); });
  confirm();
  await act(async () => { await jest.runAllTimersAsync(); });
  expect(mockToast).toHaveBeenCalledWith('share.send_failed');
  expect(forwardNoticeStore.getState().notice?.targets).toEqual([target]);
});

it('stages external payloads before clearing them and entering the destination', async () => {
  let resolveStage!: (value: unknown) => void;
  const cleanup = jest.fn();
  mockStage.mockImplementation(() => new Promise((resolve) => { resolveStage = resolve; }));
  act(() => { renderer = create(<IncomingShareForwardScreen />); });
  confirm();
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { resolveStage({ items: mockItems, cleanup }); });
  expect(mockClear).toHaveBeenCalled();
  expect(mockPrepare).toHaveBeenCalledWith('account', [target], mockItems, expect.any(Function));
  expect(mockPush).toHaveBeenCalledWith('/chat/peer', { dangerouslySingular: expect.any(Function) });
  expect(mockPrepare.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
  expect(mockBack).not.toHaveBeenCalled();
  await act(async () => { await jest.runAllTimersAsync(); });
  expect(mockRun).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it('releases the staged payload without navigating or enqueuing if the account changes during staging', async () => {
  let finish!: (value: unknown) => void;
  const cleanup = jest.fn(async () => {});
  mockStage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  act(() => { renderer = create(<IncomingShareForwardScreen />); });
  confirm();
  mockActiveAccount = 'other-account';
  await act(async () => { finish({ items: mockItems, cleanup }); });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
