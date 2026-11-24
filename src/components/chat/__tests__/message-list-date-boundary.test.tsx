import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { createRef, type ComponentProps } from 'react';

import { MessageList, type MessageListHandle } from '../MessageList';
import { MessageBubble } from '../MessageBubble';
import { RemovingMessageRow } from '../RemovingMessageRow';
import { PendingAttachmentBubble } from '../PendingAttachmentBubble';
import { DatePill, DateSeparator } from '../message-date-separator';
import { MessageLayoutViewport } from '../message-row-layout';
import { IconButton } from '@/components/common/IconButton';

let mockPreference = 'light';
let mockReducedMotion = false;
function MockTimelineTouchView({ children }: { children: React.ReactNode; onTouchCancelled: () => void }) {
  return <View>{children}</View>;
}
let mockHasTimelineTouchView = false;
jest.mock('@/platform/timeline-touch-view', () => ({
  getTimelineTouchView: () => mockHasTimelineTouchView ? MockTimelineTouchView : null,
}));
const mockClipReaction = jest.fn();
const mockRemovalCompletion = jest.fn();
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args) }));
jest.mock('@/lib/platform', () => ({
  ...jest.requireActual('@/lib/platform'),
  IS_ELECTRON: true,
}));

jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/chevron-up', () => () => null);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/theme/motion', () => ({ manipulationTiming: { duration: 200 }, messageRemovalTiming: { duration: 150 } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  Easing: { bezier: () => (value: number) => value, in: (easing: unknown) => easing, out: (easing: unknown) => easing, quad: jest.fn() },
  runOnJS: (callback: unknown) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useAnimatedReaction: (prepare: unknown, react: unknown) => mockClipReaction(prepare, react),
  useReducedMotion: () => mockReducedMotion,
  useSharedValue: (value: unknown) => {
    const { useRef } = jest.requireActual('react');
    return useRef({ value, set(next: unknown) { this.value = next; } }).current;
  },
  withTiming: (value: unknown, config?: { duration?: number }, complete?: (finished: boolean) => void) => {
    if (config?.duration === 150 && complete) mockRemovalCompletion(complete);
    return value;
  },
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

function visibleScrollButtons(list: ReactTestRenderer) {
  return list.root.findAllByType(IconButton).filter(button => {
    let parent = button.parent;
    while (parent) {
      if (parent.props.accessibilityElementsHidden) return false;
      parent = parent.parent;
    }
    return true;
  });
}

type Props = ComponentProps<typeof MessageList>;
const createdAt = Math.floor(new Date(2026, 8, 2, 8).getTime() / 1000);
const message: Props['messages'][number] = {
  deleted: false,
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
    mockHasTimelineTouchView = false;
    jest.restoreAllMocks();
  });

  it.each([false, true])('retains only visible deleted rows when reduced motion is %s', (reducedMotion) => {
    mockReducedMotion = reducedMotion;
    const second = { ...message, id: 'second', orderAt: message.orderAt + 1 };
    const offscreen = { ...message, id: 'offscreen', orderAt: message.orderAt - 1 };
    const initial = props({ messages: [offscreen, message, second] });
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = () => list.root.findByType(FlatList).props;
    act(() => {
      flatList().onViewableItemsChanged({
        viewableItems: [0, 1].map((index) => ({
          item: flatList().data[index],
          key: `m:${flatList().data[index].message.id}`,
          isViewable: true,
          index,
        })),
      });
    });
    const deleted = {
      ...initial,
      messages: [],
      deletedMessageIds: new Set([offscreen.id, message.id, second.id]),
    };

    act(() => { list.update(<MessageList {...deleted} deferRemovalAnimations />); });
    expect(flatList().data.length).toBe(reducedMotion ? 0 : 2);
    if (reducedMotion) return;
    expect(flatList().data[0].message.id).toBe(second.id);
    expect(flatList().data[1].message.id).toBe(message.id);
    expect(flatList().renderItem({ item: flatList().data[0], index: 0 }).props.play).toBe(false);

    act(() => { list.update(<MessageList {...deleted} />); });
    const firstExit = flatList().renderItem({ item: flatList().data[0], index: 0 });
    const secondExit = flatList().renderItem({ item: flatList().data[1], index: 1 });
    expect(firstExit.type).toBe(RemovingMessageRow);
    expect([firstExit.props.play, secondExit.props.play]).toEqual([true, true]);
    mockRemovalCompletion.mockClear();
    act(() => {
      row = create(<>{firstExit}{secondExit}</>);
    });
    const collapsing = row.root.findAllByType(RemovingMessageRow);
    act(() => {
      for (const preview of collapsing) {
        const content = preview.findAllByType(View).find((view) => view.props.onLayout);
        content!.props.onLayout({ nativeEvent: { layout: { height: 42 } } });
      }
    });
    expect(mockRemovalCompletion).toHaveBeenCalledTimes(2);
    act(() => {
      for (const [complete] of mockRemovalCompletion.mock.calls) complete(true);
    });
    expect(flatList().data.length).toBe(0);
  });

  it('translates the inverted list immediately and only adds history padding once settled', () => {
    const composerInset = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
    const settledComposerInset = { value: 0 } as NonNullable<Props['composerInsets']>['settled'];
    const listProps = props({ composerInsets: { live: composerInset, settled: settledComposerInset }, topInset: 48, bottomInset: 56 });
    const draw = () => act(() => { list.update(<MessageList {...listProps} />); });
    const historyHeight = () => StyleSheet.flatten(list.root.findByType(FlatList).props.ListFooterComponent.props.style).height;
    const getTimelineTransform = () => list.root.findAllByType(View)
      .map(({ props }) => StyleSheet.flatten(props.style)?.transform)
      .find((transform) => transform?.some((part: object) => 'translateY' in part) && transform.length === 1);

    act(() => { list = create(<MessageList {...listProps} />); });
    const flatList = () => list.root.findByType(FlatList);
    const instance = flatList().instance;
    const scroll = jest.spyOn(instance, 'scrollToOffset');
    const newestClearance = flatList().props.ListHeaderComponent.props.style.height;
    expect(flatList().props.inverted).toBe(true);
    expect(historyHeight()).toBe(48);

    composerInset.value = 80;
    draw();
    expect(getTimelineTransform()).toEqual([{ translateY: -80 }]);
    expect(historyHeight()).toBe(48);

    composerInset.value = settledComposerInset.value = 160;
    draw();
    expect(getTimelineTransform()).toEqual([{ translateY: -160 }]);
    expect(historyHeight()).toBe(208);

    composerInset.value = 40;
    draw();
    composerInset.value = 100;
    draw();
    expect(getTimelineTransform()).toEqual([{ translateY: -100 }]);
    expect(historyHeight()).toBe(208);

    composerInset.value = settledComposerInset.value = 0;
    draw();
    expect(historyHeight()).toBe(48);
    expect(flatList().props.ListHeaderComponent.props.style.height).toBe(newestClearance);
    expect(flatList().instance).toBe(instance);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('keeps animated frames paused between an Android drag and its momentum scroll', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    try {
      act(() => { list = create(<MessageList {...props()} />); });
      const listProps = () => list.root.findByType(FlatList).props;
      const viewport = list.root.findByType(MessageLayoutViewport);
      const visibility = viewport.props.imageVisibility;
      viewport.props.onCellFrame('m:first-message', { y: 100, height: 90 });
      act(() => { listProps().onLayout({ nativeEvent: { layout: { height: 600 } } }); });
      reportVisible([0]);
      expect(visibility.isVisible('m:first-message')).toBe(true);
      const event = { nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 600 },
        contentSize: { height: 1800 },
      } };
      act(() => { listProps().onScrollBeginDrag(); });
      expect(visibility.isVisible('m:first-message')).toBe(false);
      act(() => {
        listProps().onScrollEndDrag(event);
        listProps().onMomentumScrollBegin();
        jest.advanceTimersByTime(150);
      });
      expect(visibility.isVisible('m:first-message')).toBe(false);
      act(() => {
        listProps().onMomentumScrollEnd(event);
        jest.advanceTimersByTime(100);
      });
      expect(visibility.isVisible('m:first-message')).toBe(true);
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('stops playback for rows beyond the settled clip and resumes after a canceled drag', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    try {
      const messages = loadedHistory(3);
      act(() => { list = create(<MessageList {...props({ messages })} />); });
      const flatList = list.root.findByType(FlatList);
      const viewport = list.root.findByType(MessageLayoutViewport);
      const visibleKey = `m:${flatList.props.data[0].message.id}`;
      const clippedKey = `m:${flatList.props.data[1].message.id}`;
      const visibility = viewport.props.imageVisibility;
      act(() => {
        viewport.props.onCellFrame(visibleKey, { y: 100, height: 100 });
        viewport.props.onCellFrame(clippedKey, { y: 440, height: 120 });
        flatList.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
      });
      reportVisible([0, 1]);
      expect(visibility.isVisible(clippedKey)).toBe(true);
      settleClip(200, 0);
      expect(visibility.isVisible(clippedKey)).toBe(false);
      expect(visibility.isVisible(visibleKey)).toBe(true);
      act(() => { viewport.props.onCellFrame(clippedKey, { y: 380, height: 120 }); });
      expect(visibility.isVisible(clippedKey)).toBe(true);
      act(() => { viewport.props.onCellFrame(clippedKey, { y: 440, height: 120 }); });

      act(() => { flatList.props.onScrollBeginDrag(); });
      expect(visibility.isVisible(visibleKey)).toBe(false);
      act(() => {
        flatList.props.onTouchCancel();
        jest.advanceTimersByTime(100);
      });
      expect(visibility.isVisible(visibleKey)).toBe(true);
      act(() => {
        flatList.props.onScrollBeginDrag();
        jest.advanceTimersByTime(150);
        flatList.props.onScroll({ nativeEvent: {
          contentOffset: { y: 20 },
          layoutMeasurement: { height: 600 },
          contentSize: { height: 1200 },
        } });
        jest.advanceTimersByTime(100);
      });
      expect(visibility.isVisible(visibleKey)).toBe(false);
      act(() => { jest.advanceTimersByTime(150); });
      expect(visibility.isVisible(visibleKey)).toBe(true);
      expect(visibility.isVisible(clippedKey)).toBe(false);
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('centres a measured tall reply in the clipped viewport and clamps near the tail', () => {
    const messages = loadedHistory(4);
    const target = messages[1];
    const ref = createRef<MessageListHandle>();
    const live = { value: 200, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
    const settled = { value: 200 } as NonNullable<Props['composerInsets']>['settled'];
    act(() => {
      list = create(<MessageList {...props({
        messages, composerInsets: { live, settled }, topInset: 40, bottomInset: 50,
      })} ref={ref} />);
    });
    const flatList = list.root.findByType(FlatList);
    const viewport = list.root.findByType(MessageLayoutViewport);
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    act(() => { flatList.props.onLayout({ nativeEvent: { layout: { height: 600 } } }); });
    act(() => {
      viewport.props.onCellFrame(`m:${target.id}`, { y: 500, height: 300 });
      ref.current!.scrollToMessage(target);
    });
    expect(scroll).toHaveBeenLastCalledWith({ offset: 445, animated: true });
    act(() => {
      viewport.props.onCellFrame(`m:${target.id}`, { y: 20, height: 300 });
      ref.current!.scrollToMessage(target);
    });
    expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: true });

    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    act(() => {
      viewport.props.onCellFrame(`m:${target.id}`, null);
      ref.current!.scrollToMessage(target);
    });
    expect(scrollToIndex).toHaveBeenLastCalledWith({
      index: flatList.props.data.get(target.id),
      viewPosition: 0.5,
      viewOffset: -95,
      animated: true,
    });
  });

  function settleClip(inset: number, previousInset: number) {
    const viewport = (clip: number) => ({ clip, hasComposerClip: clip > 0 });
    const updateClip = mockClipReaction.mock.lastCall![1];
    act(() => { updateClip(viewport(inset), viewport(previousInset)); });
  }

  it('defers the newer edge after a footer-only resize and resumes on deliberate scrolling', () => {
    const settled = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['settled'];
    const live = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
    const initial = props({ anchored: true, hasMoreNewer: true, composerInsets: { live, settled } });
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = () => list.root.findByType(FlatList).props;
    const event = (y: number, height: number) => ({ nativeEvent: {
      contentOffset: { y }, layoutMeasurement: { height: 600 }, contentSize: { height },
    } });
    act(() => {
      flatList().onContentSizeChange(400, 2000);
      flatList().onScroll(event(400, 2000));
      settled.value = 180;
      flatList().onContentSizeChange(400, 2180);
      flatList().onStartReached();
    });
    expect(initial.onLoadNewer).not.toHaveBeenCalled();
    act(() => {
      flatList().onScrollBeginDrag();
      flatList().onScroll(event(430, 2180));
    });
    expect(initial.onLoadNewer).not.toHaveBeenCalled();
    act(() => { flatList().onScroll(event(410, 2180)); });
    expect(initial.onLoadNewer).toHaveBeenCalledTimes(1);
  });

  it('keeps an incoming message staged when its data update coincides with a footer-only resize', () => {
    const settled = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['settled'];
    const live = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
    const history = loadedHistory(80).map((item) => ({ ...item, senderPubkey: 'peer' }));
    const initial = props({ messages: history, composerInsets: { live, settled } });
    const flatList = () => list.root.findByType(FlatList).props;
    const event = (y: number, height: number) => ({ nativeEvent: {
      contentOffset: { y }, layoutMeasurement: { height: 600 }, contentSize: { height },
    } });
    act(() => { list = create(<MessageList {...initial} />); });
    act(() => {
      flatList().onContentSizeChange(400, 3000);
      flatList().onScroll(event(420, 3000));
    });
    const previousData = flatList().data;
    const newest = history[history.length - 1];
    const incoming = { ...newest, id: 'incoming', orderAt: newest.orderAt + 1000 };
    act(() => { list.update(<MessageList {...initial} messages={[...history, incoming]} />); });
    expect(flatList().data).not.toBe(previousData);
    expect(flatList().data.length).toBe(history.length);

    act(() => {
      settled.value = 180;
      flatList().onContentSizeChange(400, 3180);
      flatList().onStartReached();
    });
    expect(flatList().data.length).toBe(history.length);
    act(() => {
      flatList().onScrollBeginDrag();
      flatList().onScroll(event(400, 3180));
    });
    expect(flatList().data.length).toBe(history.length + 1);
  });

  it('replays the Android newest edge on finger-up after the drag idle timer has fired', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    try {
      const settled = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['settled'];
      const live = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
      const initial = props({ anchored: true, hasMoreNewer: true, composerInsets: { live, settled } });
      const flatList = () => list.root.findByType(FlatList).props;
      act(() => { list = create(<MessageList {...initial} />); });
      act(() => {
        flatList().onContentSizeChange(400, 2000);
        settled.value = 180;
        flatList().onContentSizeChange(400, 2180);
        flatList().onStartReached();
      });
      expect(initial.onLoadNewer).not.toHaveBeenCalled();
      act(() => {
        flatList().onScrollBeginDrag();
        jest.advanceTimersByTime(350);
      });
      const event = { nativeEvent: {
        contentOffset: { y: 0 }, layoutMeasurement: { height: 600 }, contentSize: { height: 2180 },
      } };
      act(() => { flatList().onMomentumScrollEnd(event); });
      expect(initial.onLoadNewer).not.toHaveBeenCalled();
      act(() => { flatList().onScrollEndDrag(event); });
      expect(initial.onLoadNewer).toHaveBeenCalledTimes(1);
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('shows the floating date if the same row stays visible but its inline date is clipped', () => {
    const live = { value: 0 } as NonNullable<Props['composerInsets']>['live'];
    const settled = { value: 0 } as NonNullable<Props['composerInsets']>['settled'];
    const initial = props({ composerInsets: { live, settled } });
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = list.root.findByType(FlatList).props;
    const viewport = list.root.findByType(MessageLayoutViewport);
    act(() => {
      viewport.props.onCellFrame(`m:${message.id}`, { y: 390, height: 220 });
      flatList.onScroll({ nativeEvent: {
        contentOffset: { y: 100 }, layoutMeasurement: { height: 600 }, contentSize: { height: 800 },
      } });
      row?.unmount();
      row = create(flatList.renderItem({ item: flatList.data[0], index: 0 }));
    });
    const date = row.root.findByType(DateSeparator);
    act(() => { date.props.onFrame(date.props.cellKey, { y: 20, height: 30 }); });
    reportVisible([0]);
    expect(list.root.findAllByType(DatePill)).toHaveLength(1);
    const renderAnimatedStyle = () => {
      act(() => { list.update(<MessageList {...initial} />); });
      const floatingDate = list.root.findAllByType(DatePill)[1];
      return StyleSheet.flatten(floatingDate.parent!.props.style)?.opacity;
    };
    settleClip(200, 0);
    expect(renderAnimatedStyle()).toBe(1);
    settleClip(0, 200);
    expect(renderAnimatedStyle()).toBe(0);
  });

  it('recomputes the unread action after clipping even without new FlatList viewability tokens', () => {
    const messages = loadedHistory(80);
    const settled = { value: 0 } as NonNullable<Props['composerInsets']>['settled'];
    const live = { value: 0 } as NonNullable<Props['composerInsets']>['live'];
    const unread = messages[0];
    const initial = props({
      messages, firstUnreadId: unread.id, firstUnreadOrderAt: unread.orderAt, unreadCount: 80,
      composerInsets: { live, settled },
    });
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = list.root.findByType(FlatList).props;
    const viewport = list.root.findByType(MessageLayoutViewport);
    const index = flatList.data.get(unread.id);
    const newer = flatList.data[index - 1].message;
    act(() => {
      viewport.props.onCellFrame(`m:${unread.id}`, { y: 370, height: 190 });
      viewport.props.onCellFrame(`m:${newer.id}`, { y: 260, height: 110 });
      flatList.onLayout({ nativeEvent: { layout: { height: 600 } } });
      row?.unmount();
      row = create(flatList.renderItem({ item: flatList.data[index], index }));
    });
    const divider = row.root.find((node) => typeof node.type === 'function' && node.type.name === 'UnreadDivider');
    act(() => {
      divider.props.onLayout({ nativeEvent: { layout: { y: 20, height: 30 } } });
    });
    reportVisible([index - 1, index]);
    expect(visibleScrollButtons(list)).toHaveLength(0);
    settleClip(200, 0);
    expect(visibleScrollButtons(list)[0].props.accessibilityLabel).toBe('chat.scroll_to_unread');
    settleClip(0, 200);
    expect(visibleScrollButtons(list)).toHaveLength(0);
  });

  it('restores tail follow when Android omits both drag-end and touch-cancel', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    try {
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
      const initial = props();
      act(() => { list = create(<MessageList {...initial} />); });
      const flatList = () => list.root.findByType(FlatList).props;
      act(() => {
        flatList().onScrollBeginDrag();
        jest.advanceTimersByTime(250);
      });
      const visibility = list.root.findByType(MessageLayoutViewport).props.imageVisibility;
      expect(visibility.isActive()).toBe(true);
      act(() => {
        for (const y of [80, 0]) {
          flatList().onScroll({ nativeEvent: {
            contentOffset: { y }, layoutMeasurement: { height: 600 }, contentSize: { height: 1000 },
          } });
        }
      });
      expect(visibility.isActive()).toBe(true);
      const messages = [message, { ...message, id: 'incoming', senderPubkey: 'peer', orderAt: message.orderAt + 1000 }];
      act(() => { list.update(<MessageList {...initial} messages={messages} />); });
      act(() => { flatList().onContentSizeChange(400, 1000); });
      expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false });
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('preserves a held Android drag through media idle and resumes tail follow on native cancellation', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    mockHasTimelineTouchView = true;
    try {
      const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
      const inset = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
      const initial = props({ composerInsets: { live: inset, settled: inset } });
      act(() => { list = create(<MessageList {...initial} />); });
      const flatList = () => list.root.findByType(FlatList).props;
      const visibility = list.root.findByType(MessageLayoutViewport).props.imageVisibility;
      const scrollEvent = (y: number) => ({ nativeEvent: {
        contentOffset: { y }, layoutMeasurement: { height: 600 }, contentSize: { height: 1000 },
      } });
      expect(flatList().onTouchCancel).toBeUndefined();
      act(() => {
        flatList().onScrollBeginDrag();
        jest.advanceTimersByTime(350);
      });
      expect(visibility.isActive()).toBe(true);
      act(() => { flatList().onScroll(scrollEvent(40)); });
      expect(visibility.isActive()).toBe(false);

      const incoming = { ...message, id: 'incoming-held', senderPubkey: 'peer', orderAt: message.orderAt + 1000 };
      act(() => { list.update(<MessageList {...initial} messages={[message, incoming]} />); });
      scroll.mockClear();
      act(() => { flatList().onContentSizeChange(400, 1300); });
      expect(scroll).not.toHaveBeenCalled();

      act(() => { flatList().onScroll(scrollEvent(0)); });
      act(() => { list.root.findByType(MockTimelineTouchView).props.onTouchCancelled(); });
      act(() => { jest.advanceTimersByTime(100); });
      expect(visibility.isActive()).toBe(true);
      const afterCancel = { ...incoming, id: 'incoming-after-cancel', orderAt: incoming.orderAt + 1000 };
      act(() => { list.update(<MessageList {...initial} messages={[message, incoming, afterCancel]} />); });
      act(() => { flatList().onContentSizeChange(400, 1500); });
      expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false });
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('discards the old gesture when the Android timeline waits for and mounts a new list window', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    mockHasTimelineTouchView = true;
    try {
      const inset = { value: 0, get() { return this.value; } } as NonNullable<Props['composerInsets']>['live'];
      const initial = props({ composerInsets: { live: inset, settled: inset } });
      act(() => { list = create(<MessageList {...initial} />); });
      const originalList = list.root.findByType(FlatList);
      const visibility = list.root.findByType(MessageLayoutViewport).props.imageVisibility;
      act(() => { originalList.props.onScrollBeginDrag(); });
      expect(visibility.isActive()).toBe(false);

      act(() => { list.update(<MessageList {...initial} />); });
      expect(list.root.findByType(FlatList).instance).toBe(originalList.instance);
      expect(visibility.isActive()).toBe(false);

      const target = { ...message, id: 'new-window-target', orderAt: message.orderAt - 1000 };
      const focus = { focusMessageId: target.id };
      act(() => { list.update(<MessageList {...initial} {...focus} />); });
      expect(list.root.findAllByType(FlatList)).toHaveLength(0);
      act(() => { list.update(<MessageList {...initial} {...focus} messages={[target, message]} />); });
      const replacement = list.root.findByType(FlatList);
      expect(visibility.isActive()).toBe(true);
      act(() => { replacement.props.onScrollBeginDrag(); });
      expect(visibility.isActive()).toBe(false);
    } finally {
      android.restore();
      jest.useRealTimers();
    }
  });

  it('resumes visible Android images after a drag is interrupted by losing focus', () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    try {
      const initial = props();
      act(() => { list = create(<MessageList {...initial} />); });
      const flatList = () => list.root.findByType(FlatList).props;
      const viewport = list.root.findByType(MessageLayoutViewport);
      const visibility = viewport.props.imageVisibility;
      const key = `m:${message.id}`;
      act(() => {
        viewport.props.onCellFrame(key, { y: 100, height: 90 });
        flatList().onLayout({ nativeEvent: { layout: { height: 600 } } });
      });
      reportVisible([0]);
      expect(visibility.isVisible(key)).toBe(true);
      act(() => { flatList().onScrollBeginDrag(); });
      expect(visibility.isVisible(key)).toBe(false);
      act(() => { list.update(<MessageList {...initial} liveDataEnabled={false} />); });
      act(() => {
        jest.advanceTimersByTime(350);
        flatList().onMomentumScrollBegin();
      });
      expect(visibility.isVisible(key)).toBe(false);
      act(() => { list.update(<MessageList {...initial} />); });
      expect(visibility.isVisible(key)).toBe(true);
    } finally {
      android.restore();
      jest.useRealTimers();
    }
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
        item: flatList.props.data[index], index, isViewable: true, key: flatList.props.keyExtractor(flatList.props.data[index]),
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

  it('clears the bottom button when returning to a fresh tail list without a scroll event', () => {
    jest.useFakeTimers();
    try {
      const history = loadedHistory(80);
      const onJumpToTail = jest.fn();
      const initial = props({ messages: history, anchored: true, hasMoreNewer: true,
        focusMessageId: history[20].id, onJumpToTail });
      jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
      const offset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
      const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
        layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
      act(() => { list = create(<MessageList {...initial} />); });
      act(() => { jest.advanceTimersByTime(300); });
      const previousList = list.root.findByType(FlatList).instance;
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1100)); });
      act(() => { list.root.findByType(IconButton).props.onPress(); });
      expect(onJumpToTail).toHaveBeenCalledTimes(1);
      act(() => { list.update(<MessageList {...initial} anchored={false} hasMoreNewer={false}
        focusMessageId={undefined} tailJumpVersion={1} />); });
      act(() => { jest.advanceTimersByTime(20); });
      expect(list.root.findByType(FlatList).instance).not.toBe(previousList);
      expect(offset).toHaveBeenCalledWith({ offset: 0, animated: false });
      expect(visibleScrollButtons(list)).toHaveLength(0);
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
      expect(visibleScrollButtons(list)).toHaveLength(0);
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1100)); });
      expect(visibleScrollButtons(list)).toHaveLength(1);
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it('updates the bottom button from the final settled position without another scroll tick', () => {
    const offset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
      layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
    act(() => { list = create(<MessageList {...props({ messages: loadedHistory(80) })} />); });
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1100)); });
    act(() => { list.root.findByType(IconButton).props.onPress(); });
    expect(offset).toHaveBeenCalledWith({ offset: 0, animated: true });
    expect(visibleScrollButtons(list)).toHaveLength(1);
    act(() => { list.root.findByType(FlatList).props.onMomentumScrollEnd(event(0)); });
    expect(visibleScrollButtons(list)).toHaveLength(0);
  });

  it('shows the bottom control only while returning toward newer messages', () => {
    const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
      layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
    act(() => { list = create(<MessageList {...props({ messages: loadedHistory(80) })} />); });
    const scroll = (y: number) => act(() => {
      list.root.findByType(FlatList).props.onScroll(event(y));
    });
    scroll(1200);
    expect(visibleScrollButtons(list)).toHaveLength(0);
    scroll(1176);
    expect(visibleScrollButtons(list)).toHaveLength(1);
    scroll(1152);
    scroll(1176);
    expect(visibleScrollButtons(list)).toHaveLength(0);
    scroll(1200);
    expect(visibleScrollButtons(list)).toHaveLength(0);
    scroll(1100);
    expect(visibleScrollButtons(list)).toHaveLength(1);
    scroll(300);
    expect(visibleScrollButtons(list)).toHaveLength(0);
  });

  it('does not reveal the bottom control while a send scrolls automatically', () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
      const initial = props({ messages: loadedHistory(80) });
      const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
        layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
      act(() => { list = create(<MessageList {...initial} />); });
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
      act(() => { list.update(<MessageList {...initial} pendingTailVersion={1} />); });
      act(() => { jest.advanceTimersByTime(20); });
      act(() => { list.root.findByType(FlatList).props.onMomentumScrollBegin(); });
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1100)); });
      expect(visibleScrollButtons(list)).toHaveLength(0);
      act(() => { list.root.findByType(FlatList).props.onScrollBeginDrag(); });
      act(() => { list.root.findByType(FlatList).props.onScroll(event(1000)); });
      expect(visibleScrollButtons(list)).toHaveLength(1);
    } finally {
      act(() => { list?.unmount(); });
      jest.useRealTimers();
    }
  });

  it.each(['light', 'dark'])('shows only the unread action at the live tail in %s mode', preference => {
    mockPreference = preference;
    const initial = props({ firstUnreadId: 'older-unread',
      firstUnreadOrderAt: message.orderAt - 1000, unreadCount: 60 });
    act(() => { list = create(<MessageList {...initial} />); });
    expect(visibleScrollButtons(list)).toHaveLength(1);
    expect(visibleScrollButtons(list)[0].props.accessibilityLabel).toBe('chat.scroll_to_unread');
    expect(list.root.findAllByProps({ accessibilityLabel: 'chat.scroll_to_latest' })).toHaveLength(0);
    act(() => { visibleScrollButtons(list)[0].props.onPress(); });
    expect(initial.onFocusAnchor).toHaveBeenCalledWith({ id: 'older-unread', orderAt: message.orderAt - 1000 });
  });

  it('pins the loaded unread action until its divider becomes visible', () => {
    const history = loadedHistory(80);
    const initial = props({ messages: history, firstUnreadId: history[0].id,
      firstUnreadOrderAt: history[0].orderAt, unreadCount: 80 });
    act(() => { list = create(<MessageList {...initial} />); });
    const flatList = () => list.root.findByType(FlatList);
    const visible = (index: number) => act(() => {
      flatList().props.onViewableItemsChanged({ viewableItems: [{ index,
        item: flatList().props.data[index], isViewable: true }] });
    });
    visible(0);
    expect(visibleScrollButtons(list)).toHaveLength(1);
    expect(visibleScrollButtons(list)[0].props.accessibilityLabel).toBe('chat.scroll_to_unread');
    act(() => { flatList().props.onScroll({ nativeEvent: {
      contentOffset: { y: 1200 }, layoutMeasurement: { height: 800 },
      contentSize: { height: 6000 },
    } }); });
    visible(history.length - 1);
    expect(visibleScrollButtons(list)).toHaveLength(0);
  });

  it('keeps unread navigation ahead of staged arrivals and restores the latest action afterward', () => {
    const history = loadedHistory(80).map(row => ({ ...row, senderPubkey: 'peer' }));
    const initial = props({ messages: history, firstUnreadId: 'older-unread',
      firstUnreadOrderAt: history[0].orderAt - 1000, unreadCount: 60 });
    const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
      layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
    act(() => { list = create(<MessageList {...initial} />); });
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
    const newest = history[history.length - 1];
    const messages = [...history, { ...newest, id: 'incoming', orderAt: newest.orderAt + 1000 }];
    act(() => { list.update(<MessageList {...initial} messages={messages} />); });
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1600)); });
    expect(visibleScrollButtons(list)).toHaveLength(1);
    expect(visibleScrollButtons(list)[0].props.accessibilityLabel).toBe('chat.scroll_to_unread');
    act(() => { visibleScrollButtons(list)[0].props.onPress(); });
    expect(initial.onFocusAnchor).toHaveBeenCalledWith({ id: 'older-unread', orderAt: history[0].orderAt - 1000 });
    expect(initial.onJumpToTail).not.toHaveBeenCalled();
    act(() => { list.update(<MessageList {...initial} messages={messages} firstUnreadId={null} />); });
    expect(visibleScrollButtons(list)).toHaveLength(1);
    expect(visibleScrollButtons(list)[0].props.accessibilityLabel).toBe('chat.scroll_to_latest');
  });

  it('keeps the bottom control visible for arrivals while scrolling toward older messages', () => {
    const history = loadedHistory(80).map(row => ({ ...row, senderPubkey: 'peer' }));
    const initial = props({ messages: history });
    const event = (y: number) => ({ nativeEvent: { contentOffset: { y },
      layoutMeasurement: { height: 800 }, contentSize: { height: 6000 } } });
    act(() => { list = create(<MessageList {...initial} />); });
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1200)); });
    const newest = history[history.length - 1];
    act(() => { list.update(<MessageList {...initial} messages={[...history,
      { ...newest, id: 'incoming', orderAt: newest.orderAt + 1000 }]} />); });
    expect(visibleScrollButtons(list)).toHaveLength(1);
    act(() => { list.root.findByType(FlatList).props.onScroll(event(1600)); });
    expect(visibleScrollButtons(list)).toHaveLength(1);
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
