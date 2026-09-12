import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Options = {
  inverted?: boolean;
  /** Change when replacing the scrollable with a different list. */
  resetKey?: unknown;
};

/**
 * Tracks content hidden above the visual top. Only threshold crossings update
 * React state; scroll frames do constant work regardless of history size.
 * Inverted lists also attach measurementProps to resolve their initial boundary
 * and recalculate it when the viewport or loaded content changes.
 */
export function useScrolled({ inverted = false, resetKey }: Options = {}) {
  const [scrolled, setScrolled] = useState(false);
  const current = useRef(false);
  const previousResetKey = useRef(resetKey);
  const metrics = useRef({ offset: 0, contentHeight: 0, viewportHeight: 0 });

  const update = useCallback(() => {
    const { offset, contentHeight, viewportHeight } = metrics.current;
    // A small tolerance absorbs fractional layout rounding at the inverted end.
    const next = inverted
      ? viewportHeight > 0 && contentHeight - viewportHeight - offset > 1
      : offset > 0;
    if (current.current !== next) {
      current.current = next;
      setScrolled(next);
    }
  }, [inverted]);

  useEffect(() => {
    if (Object.is(previousResetKey.current, resetKey)) return;
    previousResetKey.current = resetKey;
    metrics.current = { offset: 0, contentHeight: 0, viewportHeight: 0 };
    current.current = false;
    setScrolled(false);
  }, [resetKey]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    metrics.current = {
      offset: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    };
    update();
  }, [update]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    metrics.current.viewportHeight = e.nativeEvent.layout.height;
    update();
  }, [update]);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    metrics.current.contentHeight = height;
    update();
  }, [update]);

  return {
    scrolled,
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    measurementProps: { onLayout, onContentSizeChange },
  };
}
