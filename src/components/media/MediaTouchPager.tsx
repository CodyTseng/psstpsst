import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useIsRTL } from '@/i18n/direction';

const SETTLE = { duration: 400, dampingRatio: 0.8, overshootClamping: true } as const;

type Props = {
  width: number;
  height: number;
  pageKey: string;
  enabled: boolean;
  previous?: ReactNode;
  next?: ReactNode;
  children: ReactNode;
  onPage: (direction: -1 | 1) => void;
};

/** Keep the selected surface mounted at the viewport origin through rotation. */
export function MediaTouchPager({ width, height, pageKey, enabled, previous, next, children, onPage }: Props) {
  const translation = useSharedValue(0);
  const committing = useSharedValue(false);
  const reducedMotion = useReducedMotion();
  const direction = useIsRTL() ? -1 : 1;
  const hasPrevious = previous != null;
  const hasNext = next != null;

  useLayoutEffect(() => {
    cancelAnimation(translation);
    translation.set(0);
    committing.set(false);
  }, [width, height, pageKey, translation, committing]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .maxPointers(1)
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onStart(() => {
      if (!committing.get()) cancelAnimation(translation);
    })
    .onUpdate((event) => {
      if (committing.get()) return;
      const forward = -event.translationX * direction > 0;
      const available = forward ? hasNext : hasPrevious;
      translation.set(event.translationX * (available ? 1 : 0.2));
    })
    .onEnd((event) => {
      if (committing.get()) return;
      const projected = event.translationX + event.velocityX * 0.15;
      const step = projected * direction < 0 ? 1 : -1;
      const available = step === 1 ? hasNext : hasPrevious;
      if (available && (Math.abs(event.translationX) > width * 0.2 || Math.abs(event.velocityX) > 800)) {
        committing.set(true);
        if (reducedMotion) scheduleOnRN(onPage, step);
        else translation.set(withSpring(-step * direction * width, { ...SETTLE, velocity: event.velocityX }, (finished) => {
          if (finished) scheduleOnRN(onPage, step);
        }));
      } else translation.set(withSpring(0, { ...SETTLE, velocity: event.velocityX }));
    })
    .onFinalize((_event, success) => {
      if (!success && !committing.get()) translation.set(withSpring(0, SETTLE));
    }), [enabled, direction, hasNext, hasPrevious, width, reducedMotion, onPage, translation, committing]);

  const currentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: reducedMotion ? 0 : translation.get() }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={{ flex: 1, overflow: 'hidden' }}>
        {hasPrevious && !reducedMotion ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: '-100%', end: '100%' }, currentStyle]}>{previous}</Animated.View> : null}
        {hasNext && !reducedMotion ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: '100%', end: '-100%' }, currentStyle]}>{next}</Animated.View> : null}
        <Animated.View key={pageKey} testID="media-current-surface" style={[StyleSheet.absoluteFill, currentStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
