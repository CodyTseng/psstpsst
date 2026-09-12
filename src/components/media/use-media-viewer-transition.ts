import { useEffect, useRef, useState } from 'react';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { mediaViewerTiming } from '@/theme/motion';

/** Fade the stable viewer, then release its content and any navigation handoff. */
export function useMediaViewerTransition(onClosed: () => void, dragOpacity?: SharedValue<number>) {
  const visibility = useSharedValue(0);
  const mounted = useRef(false);
  const closing = useRef(false);
  const [isClosing, setIsClosing] = useState(false);
  const [entered, setEntered] = useState(false);

  function requestClose(afterClosed?: () => void) {
    if (!mounted.current || closing.current) return;
    closing.current = true;
    setIsClosing(true);
    let completed = false;
    const finish = () => {
      if (!mounted.current || completed) return;
      completed = true;
      onClosed();
      afterClosed?.();
    };
    visibility.value = withTiming(0, mediaViewerTiming.exit, (finished) => {
      'worklet';
      if (finished) runOnJS(finish)();
    });
  }

  useEffect(() => {
    mounted.current = true;
    const finishEntering = () => {
      if (mounted.current && !closing.current) setEntered(true);
    };
    const frame = requestAnimationFrame(() => {
      if (closing.current) return;
      visibility.value = withTiming(1, mediaViewerTiming.enter, (finished) => {
        'worklet';
        if (finished) runOnJS(finishEntering)();
      });
    });
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame);
      cancelAnimation(visibility);
    };
  }, [visibility]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * (dragOpacity?.value ?? 1),
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: visibility.value }));

  return { animatedStyle, contentStyle, isClosing, entered, requestClose };
}
