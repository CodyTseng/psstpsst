import {
  useCallback, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ReactNode, type Ref,
} from 'react';
import { Platform } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { isNearMessageTail } from '@/lib/chat/message-tail-follow';
import { spacing } from '@/theme';
import { manipulationTiming } from '@/theme/motion';

export interface MessageScrollControlHandle {
  updateOffset(offsetY: number): void;
  suppressForAutoScroll(): void;
  beginUserScroll(): void;
}

/** Keep per-scroll animation updates outside the message list's render state. */
export function MessageScrollControl({ ref, pinned, hasNewer = false, bottomInset, children }: {
  ref: Ref<MessageScrollControlHandle>;
  pinned: boolean;
  hasNewer?: boolean;
  bottomInset: number;
  children: ReactNode;
}) {
  const progress = useSharedValue(pinned ? 1 : 0);
  const previousOffset = useRef(0);
  const towardNewer = useRef(false);
  const autoScroll = useRef(false);
  const visibleRef = useRef(pinned);
  const [visible, setVisible] = useState(pinned);
  const update = useCallback((show: boolean) => {
    if (visibleRef.current === show) return;
    visibleRef.current = show;
    setVisible(show);
    progress.set(withTiming(Number(show), manipulationTiming));
  }, [progress]);

  const reconcileVisibility = useCallback(() => {
    update(pinned || (
      !autoScroll.current &&
      towardNewer.current &&
      (hasNewer || !isNearMessageTail(previousOffset.current))
    ));
  }, [pinned, hasNewer, update]);

  useImperativeHandle(ref, () => ({
    suppressForAutoScroll() {
      autoScroll.current = true;
      reconcileVisibility();
    },
    beginUserScroll() {
      autoScroll.current = false;
    },
    updateOffset(offsetY) {
      const y = Math.max(0, offsetY);
      // Inverted coordinates decrease when moving toward newer messages.
      const delta = previousOffset.current - y;
      previousOffset.current = y;
      if (delta !== 0) towardNewer.current = delta > 0;
      reconcileVisibility();
    },
  }), [reconcileVisibility]);

  useLayoutEffect(reconcileVisibility, [reconcileVisibility]);

  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      {...(Platform.OS === 'web' ? { inert: !visible } : {})}
      aria-hidden={!visible}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[{
        position: 'absolute', end: spacing.lg, bottom: bottomInset + spacing.lg,
        pointerEvents: visible ? 'auto' : 'none',
      }, style]}
    >
      {children}
    </Animated.View>
  );
}
