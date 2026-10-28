import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useIsRTL } from '@/i18n/direction';

const SETTLE = { duration: 400, dampingRatio: 0.8, overshootClamping: true } as const;

type Props = {
  width: number;
  height: number;
  pageKey: string;
  enabled: boolean;
  previousKey?: string;
  nextKey?: string;
  previous?: ReactNode;
  next?: ReactNode;
  children: ReactNode;
  onPage: (direction: -1 | 1) => void;
};

/** Retain media surfaces and their coordinates through the native/React handoff. */
export function MediaTouchPager({ width, height, pageKey, enabled, previousKey, nextKey, previous, next, children, onPage }: Props) {
  const previousId = previousKey ?? `${pageKey}:previous`;
  const nextId = nextKey ?? `${pageKey}:next`;
  const [anchor, setAnchor] = useState({ key: pageKey, position: 0, previousId, nextId });
  if (anchor.key !== pageKey || anchor.previousId !== previousId || anchor.nextId !== nextId) {
    const step = pageKey === anchor.nextId ? 1 : pageKey === anchor.previousId ? -1 : 0;
    setAnchor({ key: pageKey, position: anchor.position + step, previousId, nextId });
  }
  // A continuous page coordinate, never rebased when React selects a neighbour.
  const position = useSharedValue(0);
  const committing = useSharedValue(false);
  const reducedMotion = useReducedMotion();
  const direction = useIsRTL() ? -1 : 1;
  const hasPrevious = previous != null;
  const hasNext = next != null;

  useLayoutEffect(() => {
    cancelAnimation(position);
    position.set(anchor.position);
    committing.set(false);
  }, [width, height, anchor.position, position, committing]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .maxPointers(1)
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onStart(() => {
      if (!committing.get()) cancelAnimation(position);
    })
    .onUpdate((event) => {
      if (committing.get() || reducedMotion) return;
      const forward = -event.translationX * direction > 0;
      const available = forward ? hasNext : hasPrevious;
      position.set(anchor.position - event.translationX * direction / width * (available ? 1 : 0.2));
    })
    .onEnd((event) => {
      if (committing.get()) return;
      const projected = event.translationX + event.velocityX * 0.15;
      const step = projected * direction < 0 ? 1 : -1;
      const available = step === 1 ? hasNext : hasPrevious;
      const velocity = -event.velocityX * direction / width;
      if (available && (Math.abs(event.translationX) > width * 0.2 || Math.abs(event.velocityX) > 800)) {
        committing.set(true);
        if (reducedMotion) scheduleOnRN(onPage, step);
        else position.set(withSpring(anchor.position + step, { ...SETTLE, velocity }, (finished) => {
          if (finished) scheduleOnRN(onPage, step);
        }));
      } else position.set(withSpring(anchor.position, { ...SETTLE, velocity }));
    })
    .onFinalize((_event, success) => {
      if (!success && !committing.get()) position.set(withSpring(anchor.position, SETTLE));
    }), [enabled, direction, hasNext, hasPrevious, width, reducedMotion, onPage, anchor.position, position, committing]);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={{ flex: 1, overflow: 'hidden' }}>
        {[
          ...(hasPrevious ? [{ key: previousId, offset: -1, content: previous }] : []),
          { key: pageKey, offset: 0, content: children },
          ...(hasNext ? [{ key: nextId, offset: 1, content: next }] : []),
        ].map((page) => (
          <MediaTouchPage
            key={page.key}
            active={page.offset === 0}
            coordinate={anchor.position + page.offset}
            position={position}
            width={width}
            direction={direction}
          >
            {page.content}
          </MediaTouchPage>
        ))}
      </View>
    </GestureDetector>
  );
}

function MediaTouchPage({ active, coordinate, position, width, direction, children }: {
  active: boolean;
  coordinate: number;
  position: SharedValue<number>;
  width: number;
  direction: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (coordinate - position.get()) * width * direction }],
  }));
  return (
    <Animated.View
      testID={active ? 'media-current-surface' : undefined}
      style={[StyleSheet.absoluteFill, style, { pointerEvents: active ? 'auto' : 'none' }]}
    >
      {children}
    </Animated.View>
  );
}
