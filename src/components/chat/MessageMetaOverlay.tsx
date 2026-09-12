import { type ReactNode } from 'react';
import { View } from 'react-native';

import { radius, useThemeColors } from '@/theme';

type Props = {
  children?: ReactNode;
};

/** Shared inset capsule for metadata painted over media-like message content.
 * Inset 6px from both the trailing and bottom content edges — the trailing and
 * bottom insets always stay equal. */
export function MessageMetaOverlay({ children }: Props) {
  const c = useThemeColors();
  if (!children) return null;

  return (
    <View
      style={{
        position: 'absolute',
        end: 6,
        bottom: 6,
        borderRadius: radius.full,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: c.overlay,
      }}
    >
      {children}
    </View>
  );
}
