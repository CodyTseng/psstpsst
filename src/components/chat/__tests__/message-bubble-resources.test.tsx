import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MessageBubble } from '../MessageBubble';
import { impact } from '@/lib/haptics';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

const mockBodyMount = jest.fn();
const mockBodyUnmount = jest.fn();
const mockPanHandlers: Record<string, (...args: any[]) => void> = {};
const mockPanCreated = jest.fn();

jest.mock('../BubbleBody', () => ({ BubbleBody: () => {
  const React = jest.requireActual('react');
  React.useEffect(() => { mockBodyMount(); return mockBodyUnmount; }, []);
  return null;
} }));
jest.mock('../ReactionsRow', () => ({ ReactionsRow: () => null }));
jest.mock('../attachment-layout', () => ({ ATTACHMENT_FAILURE_TARGET_SIZE: 32 }));
jest.mock('../bubble-layout', () => ({ BUBBLE_GAP: 4, BUBBLE_GROUP_GAP: 8, BUBBLE_MAX_WIDTH: '80%', BUBBLE_ROW_PADDING_HORIZONTAL: 16 }));
jest.mock('@/components/common/SelectionDot', () => ({ SelectionDot: () => null }));
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/Reply', () => ({ Reply: () => null }), { virtual: true });
jest.mock('@/lib/haptics', () => ({ impact: jest.fn() }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: false }));
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => false, useDirectionalIconStyle: () => undefined }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({}) }));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: Function, ...args: unknown[]) => fn(...args) }));
jest.mock('react-native-gesture-handler', () => {
  function gesture(pan = false) {
    const g: Record<string, Function> = {};
    for (const name of ['enabled', 'hitSlop', 'activeOffsetX', 'failOffsetY', 'minDuration', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
      g[name] = (value: any) => {
        if (pan && name.startsWith('on')) mockPanHandlers[name] = value;
        return g;
      };
    }
    return g;
  }
  return {
    GestureDetector: ({ children }: any) => children,
    Gesture: {
      Pan: () => { mockPanCreated(); return gesture(true); },
      LongPress: () => gesture(), Tap: () => gesture(), Simultaneous: (...args: any[]) => args,
    },
  };
});
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true, default: { View },
    Easing: { bezier: () => undefined }, Extrapolation: { CLAMP: 'clamp' },
    ReduceMotion: { System: 'system', Never: 'never' }, FadeIn: { duration: () => undefined },
    useReducedMotion: () => false,
    useSharedValue: jest.fn((initial: any) => React.useState(() => {
      let value = initial;
      return { get: () => value, set: (next: any) => { value = next; } };
    })[0]),
    useAnimatedStyle: jest.fn(() => ({})), interpolate: () => 0, interpolateColor: () => '',
    withTiming: (value: any) => value, withDelay: (_delay: number, value: any) => value,
    withSpring: (value: any, _config: any, done: Function) => { done(true); return value; },
  };
});

it('allocates dormant decorations only when used and preserves the message body', () => {
  const props = {
    content: 'hello', isSelf: false, createdAt: 0, orderAt: 0,
    reactions: [], onTapReaction: jest.fn(), onSwipeReply: jest.fn(),
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MessageBubble {...props} />); });
  const count = (name: string) => renderer.root.findAll((node) =>
    typeof node.type === 'function' && node.type.name === name).length;
  expect(count('SwipeReplyDecorations')).toBe(0);
  expect(count('MessageHighlight')).toBe(0);
  expect(useAnimatedStyle).toHaveBeenCalledTimes(1);
  expect(useSharedValue).toHaveBeenCalledTimes(1);
  act(() => mockPanHandlers.onStart());
  expect(count('SwipeReplyDecorations')).toBe(1);
  expect(mockPanCreated).toHaveBeenCalledTimes(1);
  act(() => mockPanHandlers.onUpdate({ translationX: 100 }));
  act(() => mockPanHandlers.onUpdate({ translationX: 110 }));
  expect(impact).toHaveBeenCalledTimes(1);
  act(() => mockPanHandlers.onUpdate({ translationX: 0 }));
  act(() => mockPanHandlers.onUpdate({ translationX: -100 }));
  expect(impact).toHaveBeenCalledTimes(2);
  act(() => mockPanHandlers.onEnd({ velocityX: 0 }));
  expect(props.onSwipeReply).toHaveBeenCalledTimes(1);
  expect(count('SwipeReplyDecorations')).toBe(0);
  act(() => mockPanHandlers.onStart());
  act(() => mockPanHandlers.onFinalize({}, false));
  expect(count('SwipeReplyDecorations')).toBe(0);
  act(() => renderer.update(<MessageBubble {...props} highlighted highlightTick={1} />));
  expect(count('MessageHighlight')).toBe(1);
  act(() => renderer.update(<MessageBubble {...props} highlighted={false} />));
  expect(count('MessageHighlight')).toBe(0);
  const selectionStyle = { transform: [{ translateX: 32 }] };
  act(() => renderer.update(<MessageBubble {...props} selectionMode selectionShiftStyle={selectionStyle} />));
  expect(renderer.root.findAll((node) => Array.isArray(node.props.style) && node.props.style.includes(selectionStyle)).length).toBeGreaterThan(0);
  expect(mockBodyMount).toHaveBeenCalledTimes(1);
  expect(mockBodyUnmount).not.toHaveBeenCalled();
  act(() => renderer.unmount());
  expect(mockBodyUnmount).toHaveBeenCalledTimes(1);
});
