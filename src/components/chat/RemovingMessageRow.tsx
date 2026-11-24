import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { messageRemovalTiming } from '@/theme/motion';

export function RemovingMessageRow({ id, play, onFinished, children }: {
  id: string;
  play: boolean;
  onFinished: (id: string) => void;
  children: ReactNode;
}) {
  const [height, setHeight] = useState<number>();
  const progress = useSharedValue(1);
  useEffect(() => {
    if (!play || height === undefined) return;
    progress.set(withTiming(0, messageRemovalTiming, (finished) => {
      if (finished) scheduleOnRN(onFinished, id);
    }));
  }, [height, id, onFinished, play, progress]);

  const collapseStyle = useAnimatedStyle(() => ({
    height: height === undefined ? undefined : height * progress.value,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[styles.clip, collapseStyle]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={styles.content}
        onLayout={({ nativeEvent }) => setHeight((current) => current ?? nativeEvent.layout.height)}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  content: { flexShrink: 0 },
});
