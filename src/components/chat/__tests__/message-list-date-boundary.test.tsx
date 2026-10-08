import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';
import type { ComponentProps } from 'react';

import { MessageList } from '../MessageList';
import { DateSeparator } from '../message-date-separator';

let mockPreference = 'light';

jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/chevron-up', () => () => null);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  Easing: { out: (easing: unknown) => easing, quad: jest.fn() },
  runOnJS: (callback: unknown) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withTiming: (value: unknown) => value,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/i18n', () => ({ language: 'en', t: (key: string) => key }));
jest.mock('@/i18n/direction', () => ({
  useIsRTL: () => false,
  getLanguageDirection: () => 'ltr',
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: string; preference: string }) => unknown) =>
    selector({ accent: 'blue', preference: mockPreference }),
}));
jest.mock('@/hooks/use-messages', () => ({ MESSAGES_PAGE_SIZE: 60 }));
jest.mock('@/hooks/use-contacts', () => ({ useContactsMap: () => ({}) }));
jest.mock('@/hooks/use-profile', () => ({ useProfilesMap: () => ({}) }));
jest.mock('@/hooks/use-electron-history-pagination', () => ({
  useElectronHistoryPagination: jest.fn(),
}));
jest.mock('@/lib/perf/chat-open', () => ({ markChatMessageListMounted: jest.fn() }));
jest.mock('@/lib/chat/message-presentation', () => ({
  prepareMessagePresentation: () => ({ attachment: null }),
}));
jest.mock('@/components/common/FrostedBackdrop', () => ({ FrostedBackdrop: () => null }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('../MessageBubble', () => ({ MessageBubble: () => null }));
jest.mock('../PendingAttachmentBubble', () => ({ PendingAttachmentBubble: () => null }));
jest.mock('../GroupSystemMessage', () => ({ GroupSystemMessage: () => null }));

type Props = ComponentProps<typeof MessageList>;
const createdAt = Math.floor(new Date(2026, 8, 2, 8).getTime() / 1000);
const message: Props['messages'][number] = {
  accountPubkey: 'self',
  id: 'first-message',
  conversationKey: 'peer',
  senderPubkey: 'self',
  createdAt,
  orderAt: createdAt * 1000,
  kind: 1,
  content: 'Hello',
  tags: [],
  replyToId: null,
  subject: null,
  deliveryStatus: null,
  deliveryError: null,
  sourceRelays: null,
  rumor: {
    id: 'first-message', pubkey: 'self', created_at: createdAt,
    kind: 1, content: 'Hello', tags: [],
  },
};

function props(overrides: Partial<Props> = {}): Props {
  return {
    messages: [message],
    pendingAttachments: [],
    pendingTailVersion: 0,
    pendingFailureVersion: 0,
    accountPubkey: 'self',
    conversationKey: 'peer',
    remoteContentMode: 'auto',
    reactionsByMessageId: {},
    presentationsByMessageId: {},
    bubbleRenderItemsById: {},
    deliveriesByMessageId: {},
    referencedById: {},
    onLoadOlder: jest.fn(),
    onLoadNewer: jest.fn(),
    hasMore: false,
    loadingOlder: false,
    loadingNewer: false,
    hasMoreNewer: false,
    oldestBoundary: null,
    tailJumpVersion: 0,
    anchored: false,
    windowLoaded: true,
    onFocusAnchor: jest.fn(),
    onJumpToTail: jest.fn(),
    onLongPress: jest.fn(),
    onLongPressPending: jest.fn(),
    onTapReaction: jest.fn(),
    onRetryPending: jest.fn(),
    onStopPending: jest.fn(),
    onCancelPending: jest.fn(),
    bottomInset: 0,
    topInset: 0,
    ...overrides,
  };
}

describe('MessageList date boundaries', () => {
  let list: ReactTestRenderer;
  let row: ReactTestRenderer;

  afterEach(() => {
    act(() => {
      row?.unmount();
      list?.unmount();
    });
    mockPreference = 'light';
  });

  function renderOldestRow() {
    const flatList = list.root.findByType(FlatList);
    const index = flatList.props.data.length - 1;
    act(() => {
      row?.unmount();
      row = create(flatList.props.renderItem({ item: flatList.props.data[index], index }));
    });
    return row.root.findAllByType(DateSeparator);
  }

  it.each(['light', 'dark'])('shows the first message date capsule in %s mode', (preference) => {
    mockPreference = preference;
    act(() => { list = create(<MessageList {...props()} />); });
    expect(renderOldestRow()).toHaveLength(1);
  });

  it('shows the capsule when an unknown boundary resolves to the start of history', () => {
    const initial = props({ oldestBoundary: undefined });
    act(() => { list = create(<MessageList {...initial} />); });
    expect(renderOldestRow()).toHaveLength(0);
    act(() => { list.update(<MessageList {...initial} oldestBoundary={null} />); });
    expect(renderOldestRow()).toHaveLength(1);
  });

  it('keeps a same-day pagination boundary capsule-free', () => {
    act(() => {
      list = create(<MessageList {...props({
        hasMore: true,
        oldestBoundary: { createdAt: createdAt - 60, senderPubkey: 'self' },
      })} />);
    });
    expect(renderOldestRow()).toHaveLength(0);
  });
});
