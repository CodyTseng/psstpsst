import { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { MessageScrollControl, type MessageScrollControlHandle } from '../MessageScrollControl';

let mockProgress: { value: number; set(next: number): void };
jest.mock('@/theme', () => ({ spacing: { sm: 8, lg: 16, '3xl': 48 } }));
const mockTiming = jest.fn((value: number, _config: unknown) => value);
jest.mock('@/theme/motion', () => ({ manipulationTiming: { duration: 200, reduceMotion: 'system' } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  useSharedValue: (value: number) => {
    const { useRef } = jest.requireActual('react');
    mockProgress = useRef({ value, set(next: number) { this.value = next; } }).current;
    return mockProgress;
  },
  useAnimatedStyle: (callback: () => unknown) => callback(),
  withTiming: (value: number, config: unknown) => mockTiming(value, config),
}));

describe('MessageScrollControl', () => {
  let tree: ReactTestRenderer;
  afterEach(() => {
    act(() => { tree?.unmount(); });
  });

  it('fades on direction changes without restarting for distance or repeated ticks', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => { tree = create(<MessageScrollControl ref={ref} pinned={false} bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>); });
    const scroll = (y: number) => act(() => { ref.current!.updateOffset(y); });
    scroll(1200);
    expect(mockProgress.value).toBe(0);
    mockTiming.mockClear();
    scroll(1188);
    expect(mockProgress.value).toBe(1);
    expect(mockTiming).toHaveBeenCalledTimes(1);
    scroll(1176);
    expect(mockProgress.value).toBe(1);
    scroll(1176);
    expect(mockTiming).toHaveBeenCalledTimes(1);
    scroll(1182);
    expect(mockProgress.value).toBe(0);
    expect(mockTiming).toHaveBeenLastCalledWith(0, { duration: 200, reduceMotion: 'system' });
    scroll(1100);
    expect(mockProgress.value).toBe(1);
    scroll(1124);
    expect(mockProgress.value).toBe(0);
    scroll(1148);
    expect(mockProgress.value).toBe(0);
    expect(tree.root.findByProps({ testID: 'control' })).toBeDefined();
    scroll(300);
    expect(mockProgress.value).toBe(0);
    scroll(-20);
    expect(mockProgress.value).toBe(0);
  });

  it('pins arrivals independently of direction and clears at the tail after release', () => {
    const ref = createRef<MessageScrollControlHandle>();
    const render = (pinned: boolean) => <MessageScrollControl ref={ref} pinned={pinned} bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>;
    act(() => { tree = create(render(false)); });
    act(() => { ref.current!.updateOffset(1200); });
    act(() => { tree.update(render(true)); });
    expect(mockProgress.value).toBe(1);
    act(() => { ref.current!.updateOffset(1600); });
    expect(mockProgress.value).toBe(1);
    act(() => { ref.current!.updateOffset(0); });
    act(() => { tree.update(render(false)); });
    expect(mockProgress.value).toBe(0);
    expect(tree.root.findByProps({ testID: 'control' }).parent!.props.accessibilityElementsHidden).toBe(true);
  });

  it.each([
    { finalOffset: 1600, suppressed: false, expected: 0 },
    { finalOffset: 1100, suppressed: false, expected: 1 },
    { finalOffset: 1100, suppressed: true, expected: 0 },
    { finalOffset: 200, suppressed: false, expected: 0 },
  ])('reconciles an unpinned control at $finalOffset with suppression $suppressed', ({ finalOffset, suppressed, expected }) => {
    const ref = createRef<MessageScrollControlHandle>();
    const render = (pinned: boolean) => <MessageScrollControl ref={ref} pinned={pinned} bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>;
    act(() => { tree = create(render(true)); });
    act(() => { ref.current!.updateOffset(1200); });
    if (suppressed) act(() => { ref.current!.suppressForAutoScroll(); });
    act(() => { ref.current!.updateOffset(finalOffset); });
    // A duplicate settled event must not erase the last nonzero direction.
    act(() => { ref.current!.updateOffset(finalOffset); });
    expect(mockProgress.value).toBe(1);
    act(() => { tree.update(render(false)); });
    expect(mockProgress.value).toBe(expected);
  });

  it('uses opacity without displacement', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => { tree = create(<MessageScrollControl ref={ref} pinned bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>); });
    const animated = tree.root.findAllByType(View).find(node => Array.isArray(node.props.style));
    expect(animated!.props.style[1]).toEqual({ opacity: 1 });
  });

  it('keeps send-driven scrolling hidden until the next deliberate gesture', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => { tree = create(<MessageScrollControl ref={ref} pinned={false} bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>); });
    act(() => { ref.current!.updateOffset(1200); });
    act(() => { ref.current!.suppressForAutoScroll(); });
    act(() => { ref.current!.updateOffset(1100); });
    expect(mockProgress.value).toBe(0);
    act(() => { ref.current!.updateOffset(800); });
    expect(mockProgress.value).toBe(0);
    act(() => { ref.current!.beginUserScroll(); });
    act(() => { ref.current!.updateOffset(700); });
    expect(mockProgress.value).toBe(1);
  });

  it('does not mistake the newest edge of a history window for the live tail', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => { tree = create(<MessageScrollControl ref={ref} pinned={false} hasNewer bottomInset={0}>
      <View testID="control" />
    </MessageScrollControl>); });
    act(() => { ref.current!.updateOffset(120); });
    expect(mockProgress.value).toBe(0);
    act(() => { ref.current!.updateOffset(72); });
    expect(mockProgress.value).toBe(1);
    act(() => { ref.current!.updateOffset(0); });
    expect(mockProgress.value).toBe(1);
  });
});
