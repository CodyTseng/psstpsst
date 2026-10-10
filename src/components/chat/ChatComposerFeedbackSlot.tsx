import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Retain the transparent envelope after feedback disappears. The composer
 * offsets its height, so removing content never shifts the viewport or input.
 * Keeping feedback inside the composer bounds also preserves Android taps. */
export function ChatComposerFeedbackSlot({ children, height, onHeightChange }: {
  children?: ReactNode;
  height: number;
  onHeightChange: (height: number) => void;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={{ minHeight: height }}
      onLayout={(event) => onHeightChange(Math.max(height, event.nativeEvent.layout.height))}
    >
      {children}
    </View>
  );
}
