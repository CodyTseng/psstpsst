import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { useScrolled } from '../use-scrolled';

describe('scroll chrome boundary', () => {
  let renderer: ReactTestRenderer | undefined;
  let result: ReturnType<typeof useScrolled>;
  let renders: number;

  function Harness(props: { inverted?: boolean; resetKey?: string }) {
    result = useScrolled(props);
    renders += 1;
    return null;
  }

  function scroll(offset: number, contentHeight = 1000, viewportHeight = 400) {
    act(() => result.scrollProps.onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: offset },
        contentSize: { width: 300, height: contentHeight },
        layoutMeasurement: { width: 300, height: viewportHeight },
      },
    } as NativeSyntheticEvent<NativeScrollEvent>));
  }

  function layout(height: number) {
    act(() => result.measurementProps.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height } },
    } as LayoutChangeEvent));
  }

  beforeEach(() => { renders = 0; });
  afterEach(() => { act(() => renderer?.unmount()); });

  it('shows only after leaving the top and stays hidden during top bounce', () => {
    act(() => { renderer = create(<Harness />); });
    expect(result.scrolled).toBe(false);
    scroll(-20);
    expect(result.scrolled).toBe(false);
    scroll(1);
    expect(result.scrolled).toBe(true);
    scroll(0);
    expect(result.scrolled).toBe(false);
  });

  it('does not rerender for frames that remain on the same side of the boundary', () => {
    act(() => { renderer = create(<Harness />); });
    scroll(1);
    const afterCrossing = renders;
    for (let offset = 2; offset < 100; offset += 1) scroll(offset);
    expect(renders).toBe(afterCrossing);
  });

  it('uses the visual top of an inverted history, including bounce and rounding', () => {
    act(() => { renderer = create(<Harness inverted />); });
    scroll(0);
    expect(result.scrolled).toBe(true);
    scroll(599.5);
    expect(result.scrolled).toBe(false);
    scroll(620);
    expect(result.scrolled).toBe(false);
    scroll(580);
    expect(result.scrolled).toBe(true);
  });

  it('resolves inverted chrome before the first scroll and on content or window resize', () => {
    act(() => { renderer = create(<Harness inverted />); });
    act(() => result.measurementProps.onContentSizeChange(300, 1000));
    expect(result.scrolled).toBe(false);
    layout(400);
    expect(result.scrolled).toBe(true);
    layout(1200);
    expect(result.scrolled).toBe(false);
    layout(400);
    expect(result.scrolled).toBe(true);
    act(() => result.measurementProps.onContentSizeChange(300, 200));
    expect(result.scrolled).toBe(false);
  });

  it('recalculates the inverted boundary when older content is prepended', () => {
    act(() => { renderer = create(<Harness inverted />); });
    scroll(600);
    expect(result.scrolled).toBe(false);
    act(() => result.measurementProps.onContentSizeChange(300, 1400));
    expect(result.scrolled).toBe(true);
    scroll(1000, 1400);
    expect(result.scrolled).toBe(false);
  });

  it('clears the prior list state when a task replaces its scrollable', () => {
    act(() => { renderer = create(<Harness resetKey="conversations" />); });
    scroll(100);
    act(() => { renderer?.update(<Harness resetKey="conversations" />); });
    expect(result.scrolled).toBe(true);
    act(() => { renderer?.update(<Harness resetKey="contacts" />); });
    expect(result.scrolled).toBe(false);
    scroll(20);
    expect(result.scrolled).toBe(true);
  });
});
