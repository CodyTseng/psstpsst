import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { withSpring } from 'react-native-reanimated';

import { InteractivePressable } from '@/components/common/InteractivePressable';
import type { ConversationWithLast } from '@/hooks/use-conversations';
import { darkPalette, lightPalette } from '@/theme';
import { IncomingMessageBanner } from '../IncomingMessageBanner';
import { messageArrivalFeedback } from '@/lib/haptics';
import { noticeDismissal } from '@/theme/motion';

let mockArrival: ConversationWithLast | null = null;
let mockPreference: 'light' | 'dark' = 'light';
const mockSpringCompletions: ((finished: boolean) => void)[] = [];
let mockUserPresent = true;
jest.mock('@/platform', () => ({
  platform: { notifications: { shouldNotifyNow: () => !mockUserPresent } },
}));
jest.mock('@/lib/haptics', () => ({ messageArrivalFeedback: jest.fn() }));
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const animation = () => ({
    duration() { return this; },
    easing() { return this; },
    withInitialValues() { return this; },
    reduceMotion() { return this; },
  });
  return {
    __esModule: true,
    default: {
      View: jest.requireActual('react-native').View,
      createAnimatedComponent: (component: unknown) => component,
    },
    Easing: { out: () => (value: number) => value, bezier: () => (value: number) => value },
    FadeIn: animation(),
    FadeInUp: animation(),
    ReduceMotion: { System: 'system', Never: 'never' },
    useReducedMotion: () => false,
    useSharedValue: <T,>(initial: T) => React.useRef({
      value: initial,
      get() { return this.value; },
      set(next: T) { this.value = next; },
    }).current,
    useAnimatedStyle: (factory: () => { transform: unknown }) => ({
      get transform() { return factory().transform; },
    }),
    cancelAnimation: jest.fn(),
    withSpring: jest.fn((value: number, _config: unknown, callback?: (finished: boolean) => void) => {
      if (callback) mockSpringCompletions.push(callback);
      return value;
    }),
  };
});
jest.mock('@/hooks/use-message-arrivals', () => ({ useIncomingMessageArrival: () => mockArrival }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Alice' }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/chat/MessagePreviewText', () => ({ MessagePreviewText: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: unknown) => unknown) => selector({ accent: 'blue', preference: mockPreference }),
}));

let fixtureEpoch = 0;
const fixtureOrders = new Map<string, number>();

function message(id: string, unreadCount: number, hasReplied = true, conversationKey = 'alice'): ConversationWithLast {
  const messageId = `${fixtureEpoch}:${id}`;
  if (!fixtureOrders.has(messageId)) fixtureOrders.set(messageId, fixtureOrders.size + 1);
  const row = {
    conversation: {
      accountPubkey: 'self', conversationKey, deliveryKind: 'relay', lastMessageId: messageId,
      unreadCount, hasReplied, muted: false, lastMessageOrderAt: fixtureOrders.get(messageId)!,
    },
    lastMessageSenderPubkey: 'alice', lastMessageKind: 14, lastMessageContent: 'Hello', lastMessageTags: [],
  } as unknown as ConversationWithLast;

  return row;
}

let renderer: ReactTestRenderer;
const onOpen = jest.fn();
function render(enabled = true, activeConversationKey: string | null = null,
  requestOptions: { quietRequests?: boolean; chatsVisible?: boolean } = {}) {
  const element = <IncomingMessageBanner accountPubkey="self"
    activeConversationKey={activeConversationKey} enabled={enabled} onOpen={onOpen} {...requestOptions} />;
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}

beforeEach(() => {
  fixtureEpoch += 1;
  fixtureOrders.clear();
  jest.useFakeTimers();
  mockArrival = null;
  onOpen.mockClear();
  jest.mocked(messageArrivalFeedback).mockClear();
  jest.mocked(withSpring).mockClear();
  mockSpringCompletions.length = 0;
  mockUserPresent = true;
});

type TestPan = {
  handlers: {
    onBegin: () => void;
    onStart: () => void;
    onUpdate: (event: { translationY: number }) => void;
    onFinalize: (event: { velocityY: number }, success: boolean) => void;
  };
};
function pan() {
  return (renderer.root.findByType(GestureDetector).props.gesture as TestPan).handlers;
}
function arrive() {
  render();
  mockArrival = message('new', 2);
  render();
}
function beginDrag(y: number) {
  act(() => {
    pan().onBegin();
    pan().onStart();
    pan().onUpdate({ translationY: y });
  });
}
function finishSpring() {
  act(() => { mockSpringCompletions.pop()?.(true); });
}

it('gives one notification-style haptic per appearance without repeating it for visible updates', () => {
  render(false);
  expect(messageArrivalFeedback).not.toHaveBeenCalled();
  render();
  mockArrival = message('new', 2);
  render();
  expect(messageArrivalFeedback).toHaveBeenCalledWith();
  mockArrival = message('newer', 3);
  render();
  expect(messageArrivalFeedback).toHaveBeenCalledTimes(1);
  render(false);
  render();
  mockArrival = message('next-appearance', 4);
  render();
  expect(messageArrivalFeedback).toHaveBeenCalledTimes(2);
});

it('leaves background haptics to system notifications', () => {
  mockUserPresent = false;
  arrive();
  expect(messageArrivalFeedback).not.toHaveBeenCalled();
});

it('tracks upward travel, snaps back below the threshold, and does not open the chat', () => {
  arrive();
  beginDrag(-20);
  const draggable = renderer.root.findAllByType(View).find((node) => node.props.onLayout)!;
  expect(StyleSheet.flatten(draggable.props.style).transform).toEqual([{ translateY: -20 }]);
  act(() => { pan().onFinalize({ velocityY: -1000 }, true); });
  expect(withSpring).toHaveBeenLastCalledWith(0, expect.anything(), expect.any(Function));
  act(() => { renderer.root.findByType(InteractivePressable).props.onPress(); });
  expect(onOpen).not.toHaveBeenCalled();
  finishSpring();
  expect(renderer.root.findAllByType(InteractivePressable)).toHaveLength(1);
});

it('animates fully offscreen past the threshold and removes the notice only on completion', () => {
  arrive();
  const draggable = renderer.root.findAllByType(View).find((node) => node.props.onLayout)!;
  act(() => { draggable.props.onLayout({ nativeEvent: { layout: { height: 80 } } }); });
  beginDrag(-noticeDismissal.threshold);
  act(() => { pan().onFinalize({ velocityY: -300 }, true); });
  const [target, config] = jest.mocked(withSpring).mock.calls.at(-1)!;
  expect(target).toBeLessThan(-80);
  expect(config).toMatchObject({ velocity: -300, overshootClamping: true });
  expect(renderer.root.findAllByType(InteractivePressable)).toHaveLength(1);
  finishSpring();
  expect(renderer.toJSON()).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});

it('returns canceled drags even past the threshold and pauses expiry until settling', () => {
  arrive();
  beginDrag(-60);
  act(() => { jest.advanceTimersByTime(5000); });
  expect(renderer.root.findAllByType(InteractivePressable)).toHaveLength(1);
  act(() => { pan().onFinalize({ velocityY: 0 }, false); });
  expect(withSpring).toHaveBeenLastCalledWith(0, expect.anything(), expect.any(Function));
  finishSpring();
  act(() => { jest.advanceTimersByTime(3999); });
  expect(renderer.root.findAllByType(InteractivePressable)).toHaveLength(1);
  act(() => { jest.advanceTimersByTime(1); });
  expect(renderer.toJSON()).toBeNull();
});

it('preserves a newer arrival if an older dismissal completes late', () => {
  arrive();
  beginDrag(-50);
  act(() => { pan().onFinalize({ velocityY: -200 }, true); });
  mockArrival = message('newer', 3);
  render();
  finishSpring();
  expect(renderer.root.findAllByType(InteractivePressable)).toHaveLength(1);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined!;
  jest.useRealTimers();
});

it.each([['light', lightPalette], ['dark', darkPalette]] as const)(
  'shows a new message outside chat using %s theme and opens its conversation', (preference, palette) => {
    mockPreference = preference;
    render();
    expect(renderer.toJSON()).toBeNull();
    mockArrival = message('new', 2);
    render();
    const card = renderer.root.findByType(InteractivePressable);
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({
      backgroundColor: palette.surfaceFloating, borderColor: palette.border,
    });
    act(() => { card.props.onPress(); });
    expect(onOpen).toHaveBeenCalledWith('/chat/alice');
    expect(renderer.toJSON()).toBeNull();
  },
);

it('dismisses a visible notice without replaying it when indicators change', () => {
  arrive();
  render(false);
  render(true);
  expect(renderer.toJSON()).toBeNull();
});

it('dismisses a notice when its conversation opens', () => {
  arrive();
  render(true, 'alice');
  render(true, 'bob');
  expect(renderer.toJSON()).toBeNull();
});

it('allows request notices on Chats and clears them when quiet mode is enabled', () => {
  render(true, null, { chatsVisible: true });
  mockArrival = message('request', 1, false, 'stranger');
  render(true, null, { chatsVisible: true });
  expect(messageArrivalFeedback).toHaveBeenCalledTimes(1);
  render(true, null, { chatsVisible: true, quietRequests: true });
  render(true, null, { chatsVisible: true });
  expect(renderer.toJSON()).toBeNull();
});
