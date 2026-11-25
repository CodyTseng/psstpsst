import { useLayoutEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

/** Retain the transparent envelope after feedback disappears. The composer
 * offsets its height, so removing content never shifts the viewport or input.
 * Keeping feedback inside the composer bounds also preserves Android taps. */
export function ChatComposerFeedbackSlot({ children, height, onHeightChange, occlusion, occlusionAdjustment = 0 }: {
  children?: ReactNode;
  height: number;
  onHeightChange: (height: number) => void;
  occlusion?: SharedValue<number>;
  occlusionAdjustment?: number;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  useLayoutEffect(() => () => occlusion?.set(0), [occlusion]);
  useLayoutEffect(() => {
    occlusion?.set(Math.max(0, contentHeight + occlusionAdjustment));
  }, [contentHeight, occlusion, occlusionAdjustment]);
  return (
    <View
      style={{ minHeight: height, justifyContent: 'flex-end', zIndex: 1, pointerEvents: 'box-none' }}
      onLayout={(event) => onHeightChange(Math.max(height, event.nativeEvent.layout.height))}
    >
      {occlusion ? (
        <View
          pointerEvents="box-none"
          onLayout={({ nativeEvent }) => setContentHeight(nativeEvent.layout.height)}
        >
          {children}
        </View>
      ) : children}
    </View>
  );
}
