import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IS_ELECTRON } from '@/lib/platform';

const SNAP_BACK = { duration: 400, dampingRatio: 0.8, overshootClamping: true } as const;

type Props = {
  children: ReactNode;
  active: boolean;
  backdrop: SharedValue<number>;
  onRequestClose: () => void;
};

/** Vertical dismissal leaves horizontal paging and native control taps available. */
export function MediaDismissSurface({ children, active, backdrop, onRequestClose }: Props) {
  const translation = useSharedValue(0);
  const origin = useSharedValue(0);
  const committed = useSharedValue(false);
  const reducedMotion = useReducedMotion();
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(active && !IS_ELECTRON)
    .maxPointers(1)
    // Match the image pager's axis arbitration and distance/velocity thresholds.
    .activeOffsetY([-15, 15])
    .failOffsetX([-15, 15])
    .onStart(() => {
      cancelAnimation(translation);
      cancelAnimation(backdrop);
      origin.set(translation.get());
      committed.set(false);
    })
    .onUpdate((event) => {
      translation.set(origin.get() + event.translationY);
      backdrop.set(1 - Math.min(Math.abs(translation.get()) / 300, 1) * 0.6);
    })
    .onEnd((event) => {
      if (Math.abs(translation.get()) > 120 || Math.abs(event.velocityY) > 1000) {
        committed.set(true);
        scheduleOnRN(onRequestClose);
      } else {
        translation.set(withSpring(0, { ...SNAP_BACK, velocity: event.velocityY }));
        backdrop.set(withSpring(1, SNAP_BACK));
      }
    })
    .onFinalize((_event, success) => {
      // Cancellation must restore the viewer, including when native controls win.
      if (!success && !committed.get()) {
        translation.set(withSpring(0, SNAP_BACK));
        backdrop.set(withSpring(1, SNAP_BACK));
      }
    }), [active, backdrop, committed, onRequestClose, origin, translation]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : translation.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
