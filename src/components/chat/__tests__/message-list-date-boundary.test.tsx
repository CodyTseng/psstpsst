import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { createRef, type ComponentProps } from 'react';

import { MessageList, type MessageListHandle } from '../MessageList';
import { MessageBubble } from '../MessageBubble';
import { PendingAttachmentBubble } from '../PendingAttachmentBubble';
import { DateSeparator } from '../message-date-separator';

let mockPreference = 'light';
let mockReducedMotion = false;
jest.mock('@/lib/platform', () => ({
  ...jest.requireActual('@/lib/platform'),
  IS_ELECTRON: true,
}));

jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/chevron-up', () => () => null);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  Easing: { out: (easing: unknown) => easing, quad: jest.fn() },
  runOnJS: (callback: unknown) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useReducedMotion: () => mockReducedMotion,
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

describe('MessageList boundaries and reply navigation', () => {
  let list: ReactTestRenderer;
  let row: ReactTestRenderer;

  afterEach(() => {
    act(() => {
      row?.unmount();
      list?.unmount();
    });
    mockPreference = 'light';
    mockReducedMotion = false;
    jest.restoreAllMocks();
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

  function loadedHistory(count: number): Props['messages'] {
    return Array.from({ length: count }, (_, index) => ({
      ...message, id: `message-${index}`, orderAt: index + 1,
    }));
  }

  function reportVisible(indices: number[]) {
    const flatList = list.root.findByType(FlatList);
    act(() => {
      flatList.props.onViewableItemsChanged({ viewableItems: indices.map((index) => ({
        item: flatList.props.data[index], index, isViewable: true, key: String(index),
      })) });
    });
  }

  it.each(['light', 'dark'])('jumps to an unloaded reply without requesting history in %s mode', (preference) => {
    mockPreference = preference;
    const target = { ...message, id: 'old-target', orderAt: 1 };
    const onLoadOlder = jest.fn();
    const onFocusAnchor = jest.fn();
    act(() => {
      list = create(<MessageList {...props({
        messages: [{ ...message, replyToId: target.id }], hasMore: true,
        referencedById: { [target.id]: target }, onLoadOlder, onFocusAnchor,
      })} />);
    });
    reportVisible([0]);
    renderOldestRow();
    act(() => { row.root.findByType(MessageBubble).props.onPressReply(); });

    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(onFocusAnchor).toHaveBeenCalledWith({ id: target.id, orderAt: target.orderAt });
  });

  it.each([
    { targetIndex: 49, direct: false },
    { targetIndex: 50, direct: false },
    { targetIndex: 51, direct: true },
  ])('bounds scrolling to a loaded target at index $targetIndex', ({ targetIndex, direct }) => {
    const history = loadedHistory(80);
    const target = history[history.length - 1 - targetIndex];
    const ref = createRef<MessageListHandle>();
    const onLoadOlder = jest.fn();
    const onFocusAnchor = jest.fn();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => {
      list = create(<MessageList {...props({ messages: history, hasMore: true, onLoadOlder, onFocusAnchor })} ref={ref} />);
    });
    reportVisible([0, 1, 2, 3, 4, 5]);
    scroll.mockClear();
    act(() => { ref.current!.scrollToMessage(target); });
    expect(onLoadOlder).not.toHaveBeenCalled();
    if (direct) {
      expect(onFocusAnchor).toHaveBeenCalledWith({ id: target.id, orderAt: target.orderAt });
      expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
    } else {
      expect(onFocusAnchor).not.toHaveBeenCalled();
      expect(scroll).toHaveBeenCalledWith({ index: targetIndex, viewPosition: 0.5, animated: true });
    }
  });

  it.each([false, true])('uses loaded message positions regardless of viewability callbacks (%s)', (stale) => {
    const history = loadedHistory(100);
    const target = history[0];
    const source = { ...history[1], replyToId: target.id };
    history[1] = source;
    const onLoadOlder = jest.fn();
    const onFocusAnchor = jest.fn();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => {
      list = create(<MessageList {...props({ messages: history, onLoadOlder, onFocusAnchor })} />);
    });
    if (stale) reportVisible([0, 1]);
    const flatList = list.root.findByType(FlatList);
    const index = Array.from(flatList.props.data as ArrayLike<{ message?: { id: string } }>).findIndex((item) => item.message?.id === source.id);
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[index], index })); });
    scroll.mockClear();
    act(() => { row.root.findByType(MessageBubble).props.onPressReply(); });
    expect(scroll).toHaveBeenCalledWith({ index: 99, viewPosition: 0.5, animated: true });
    expect(onFocusAnchor).not.toHaveBeenCalled();
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('keeps a nearby late-arriving reply smooth after the live tail replaces a row', () => {
    const history = loadedHistory(100);
    const target = { ...message, id: 'late-target', orderAt: 90.5 };
    history[85] = { ...history[85], replyToId: target.id };
    const source = history[85];
    const onFocusAnchor = jest.fn();
    const initial = props({ messages: history, onFocusAnchor, referencedById: { [target.id]: target } });
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...initial} />); });
    const refreshed = [...history.slice(0, 84), ...history.slice(85, 90), target, ...history.slice(90)];
    act(() => { list.update(<MessageList {...initial} messages={refreshed} />); });
    const flatList = list.root.findByType(FlatList);
    const index = Array.from(flatList.props.data as ArrayLike<{ message?: { id: string } }>).findIndex((item) => item.message?.id === source.id);
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[index], index })); });
    scroll.mockClear();
    act(() => { row.root.findByType(MessageBubble).props.onPressReply(); });
    expect(scroll).toHaveBeenCalledWith({ index: 10, viewPosition: 0.5, animated: true });
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('measures a pending attachment reply from its own loaded position', () => {
    const history = loadedHistory(100);
    const target = history[2];
    const onFocusAnchor = jest.fn();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => {
      list = create(<MessageList {...props({ messages: history, onFocusAnchor,
        pendingAttachments: [{
          accountPubkey: 'self', conversationKey: 'peer', tempId: 'old-upload',
          localUri: 'local-file', mime: 'application/octet-stream', status: 'paused',
          messageOrderAt: 6, replyToId: target.id,
        }],
      })} />);
    });
    const flatList = list.root.findByType(FlatList);
    const index = flatList.props.data.pendingIndex('old-upload');
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[index], index })); });
    scroll.mockClear();
    act(() => { row.root.findByType(PendingAttachmentBubble).props.onPressReply(); });
    expect(scroll).toHaveBeenCalledWith({ index: 98, viewPosition: 0.5, animated: true });
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('uses fresh positions for a nearby quote after a far jump and forward paging', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(120);
      const farTarget = history[40];
      const nearTarget = history[48];
      history[119] = { ...history[119], replyToId: farTarget.id };
      history[50] = { ...history[50], replyToId: nearTarget.id };
      const onFocusAnchor = jest.fn();
      const initial = props({ messages: history, onFocusAnchor });
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      act(() => { list = create(<MessageList {...initial} />); });
      const tail = list.root.findByType(FlatList);
      act(() => { row = create(tail.props.renderItem({ item: tail.props.data[0], index: 0 })); });
      act(() => { row.root.findByType(MessageBubble).props.onPressReply(); });
      expect(onFocusAnchor).toHaveBeenCalledWith({ id: farTarget.id, orderAt: farTarget.orderAt });

      act(() => { list.update(<MessageList {...initial} messages={history.slice(20, 61)} anchored />); });
      act(() => { jest.advanceTimersByTime(300); });
      const focused = list.root.findByType(FlatList);
      act(() => {
        row.unmount();
        row = create(focused.props.renderItem({ item: focused.props.data[10], index: 10 }));
      });
      const retainedNearPress = row.root.findByType(MessageBubble).props.onPressReply;
      act(() => { list.update(<MessageList {...initial} messages={history.slice(20, 86)} anchored />); });
      scroll.mockClear();
      act(() => { retainedNearPress(); });
      expect(scroll).toHaveBeenCalledWith({ index: 37, viewPosition: 0.5, animated: true });
      expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({ index: 12 }));
      expect(onFocusAnchor).toHaveBeenCalledTimes(1);
      scroll.mockClear();
      act(() => { jest.advanceTimersByTime(300); });
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('uses the committed window when a memoized row retains its old reply callback', () => {
    const history = loadedHistory(41);
    const target = history[28]; // Initial index 12, later index 37.
    history[30] = { ...history[30], replyToId: target.id }; // Source index 10, later 35.
    const onFocusAnchor = jest.fn();
    const initial = props({ messages: history, anchored: true, onFocusAnchor });
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = list.root.findByType(FlatList);
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[10], index: 10 })); });
    const retainedPress = row.root.findByType(MessageBubble).props.onPressReply;
    const newer = Array.from({ length: 25 }, (_, index) => ({ ...message, id: `newer-${index}`, orderAt: 42 + index }));
    act(() => { list.update(<MessageList {...initial} messages={[...history, ...newer]} />); });
    scroll.mockClear();
    act(() => { retainedPress(); });
    expect(scroll).toHaveBeenCalledWith({ index: 37, viewPosition: 0.5, animated: true });
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('keeps an old row callback smooth when its target becomes loaded by pagination', () => {
    const history = loadedHistory(41);
    const target = { ...message, id: 'newly-loaded-target', orderAt: 0 };
    history[20] = { ...history[20], replyToId: target.id };
    const onFocusAnchor = jest.fn();
    const initial = props({ messages: history, anchored: true, onFocusAnchor, referencedById: { [target.id]: target } });
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = list.root.findByType(FlatList);
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[20], index: 20 })); });
    const retainedPress = row.root.findByType(MessageBubble).props.onPressReply;
    const older = Array.from({ length: 14 }, (_, index) => ({ ...message, id: `older-${index}`, orderAt: index - 14 }));
    act(() => { list.update(<MessageList {...initial} messages={[...older, target, ...history]} />); });
    scroll.mockClear();
    act(() => { retainedPress(); });
    expect(scroll).toHaveBeenCalledWith({ index: 41, viewPosition: 0.5, animated: true });
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('uses the actual mounted target position instead of RN Web height estimates', () => {
    const history = loadedHistory(59);
    const target = history[30]; // Target index 28, source index 26.
    history[32] = { ...history[32], replyToId: target.id };
    const node = {
      scrollTop: 2071, scrollHeight: 6963, clientHeight: 793,
      getBoundingClientRect: () => ({ top: 0, height: 793 }),
      querySelectorAll: () => [{
        getAttribute: () => target.id,
        getBoundingClientRect: () => ({ top: 80, height: 200 }),
      }],
    };
    jest.spyOn(FlatList.prototype, 'getScrollableNode').mockReturnValue(node);
    const byIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    const byOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    const onFocusAnchor = jest.fn();
    act(() => { list = create(<MessageList {...props({ messages: history, anchored: true, onFocusAnchor, topInset: 50, bottomInset: 100 })} />); });
    const flatList = list.root.findByType(FlatList);
    act(() => { row = create(flatList.props.renderItem({ item: flatList.props.data[26], index: 26 })); });
    byIndex.mockClear();
    byOffset.mockClear();
    act(() => { row.root.findByType(MessageBubble).props.onPressReply(); });
    expect(byOffset).toHaveBeenCalledWith({ offset: 2262.5, animated: true });
    expect(byIndex).not.toHaveBeenCalled();
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('does not use a visible range to make a distant loaded target smooth', () => {
    const history = loadedHistory(100);
    const ref = createRef<MessageListHandle>();
    const onFocusAnchor = jest.fn();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...props({ messages: history, onFocusAnchor })} ref={ref} />); });
    reportVisible([70, 71, 72, 73, 74, 75]);
    scroll.mockClear();
    const target = history[100 - 1 - 65];
    act(() => { ref.current!.scrollToMessage(target); });
    expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
    expect(onFocusAnchor).toHaveBeenCalledWith({ id: target.id, orderAt: target.orderAt });
  });

  it('does not load a margin above a nearby target at the oldest loaded edge', () => {
    const history = loadedHistory(6);
    const ref = createRef<MessageListHandle>();
    const onLoadOlder = jest.fn();
    const onFocusAnchor = jest.fn();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...props({ messages: history, hasMore: true, onLoadOlder, onFocusAnchor })} ref={ref} />); });
    reportVisible([0, 1]);
    scroll.mockClear();
    act(() => { ref.current!.scrollToMessage(history[0]); });
    expect(scroll).toHaveBeenCalledWith({ index: 5, viewPosition: 0.5, animated: true });
    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(onFocusAnchor).not.toHaveBeenCalled();
  });

  it('honours reduced motion for a nearby source', () => {
    mockReducedMotion = true;
    const history = loadedHistory(6);
    const ref = createRef<MessageListHandle>();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => { list = create(<MessageList {...props({ messages: history })} ref={ref} />); });
    reportVisible([0, 1]);
    scroll.mockClear();
    act(() => { ref.current!.scrollToMessage(history[0]); });
    expect(scroll).toHaveBeenCalledWith({ index: 5, viewPosition: 0.5, animated: false });
  });

  it('repositions a repeated far target and overrides the original search target', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(80);
      const target = history[0];
      const ref = createRef<MessageListHandle>();
      const onFocusAnchor = jest.fn();
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      act(() => {
        list = create(<MessageList {...props({
          messages: history, anchored: true, focusMessageId: history[79].id, onFocusAnchor,
        })} ref={ref} />);
      });
      act(() => { jest.advanceTimersByTime(300); });
      reportVisible([0, 1]);
      const previousList = list.root.findByType(FlatList).instance;
      act(() => { ref.current!.scrollToMessage(target); });
      expect(list.root.findByType(FlatList).instance).not.toBe(previousList);
      act(() => { jest.advanceTimersByTime(300); });
      expect(scroll).toHaveBeenLastCalledWith({ index: 79, viewPosition: 0.5, animated: false });
      scroll.mockClear();
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(target); });
      act(() => { jest.advanceTimersByTime(300); });
      expect(scroll).toHaveBeenCalledWith({ index: 79, viewPosition: 0.5, animated: false });
      expect(onFocusAnchor).toHaveBeenCalledTimes(2);
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('cancels an earlier focus correction when a newer nearby jump starts', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(80);
      const ref = createRef<MessageListHandle>();
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      act(() => { list = create(<MessageList {...props({ messages: history, anchored: true })} ref={ref} />); });
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(history[0]); });
      act(() => { jest.advanceTimersByTime(20); });
      expect(scroll).toHaveBeenCalledWith({ index: 79, viewPosition: 0.5, animated: false });
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(history[77]); });
      scroll.mockClear();
      act(() => { jest.advanceTimersByTime(300); });
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('retries the target identity at its new index after rows arrive', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(80);
      const ref = createRef<MessageListHandle>();
      const initial = props({ messages: history });
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      act(() => { list = create(<MessageList {...initial} ref={ref} />); });
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(history[59]); });
      act(() => {
        list.root.findByType(FlatList).props.onScrollToIndexFailed({
          index: 20, highestMeasuredFrameIndex: 10, averageItemLength: 0,
        });
      });
      act(() => { list.update(<MessageList {...initial} messages={[
        ...history, { ...message, id: 'new-arrival', orderAt: 81 },
      ]} ref={ref} />); });
      scroll.mockClear();
      act(() => { jest.advanceTimersByTime(80); });
      expect(scroll).toHaveBeenCalledWith({ index: 21, viewPosition: 0.5, animated: false });
      expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({ index: 20 }));
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('discards a failed-scroll retry when a newer jump starts', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(80);
      const ref = createRef<MessageListHandle>();
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      act(() => { list = create(<MessageList {...props({ messages: history })} ref={ref} />); });
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(history[59]); });
      act(() => {
        list.root.findByType(FlatList).props.onScrollToIndexFailed({
          index: 20, highestMeasuredFrameIndex: 10, averageItemLength: 0,
        });
      });
      act(() => { ref.current!.scrollToMessage(history[77]); });
      scroll.mockClear();
      act(() => { jest.advanceTimersByTime(80); });
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('does not let a delayed return-to-tail correction override a reply jump', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(30);
      const ref = createRef<MessageListHandle>();
      const initial = props({ messages: history });
      jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      const offset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
      act(() => { list = create(<MessageList {...initial} ref={ref} />); });
      act(() => { list.update(<MessageList {...initial} tailJumpVersion={1} ref={ref} />); });
      act(() => { jest.advanceTimersByTime(20); });
      reportVisible([0, 1]);
      act(() => { ref.current!.scrollToMessage(history[9]); });
      offset.mockClear();
      act(() => { jest.advanceTimersByTime(300); });
      expect(offset).not.toHaveBeenCalled();
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
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
