import { type ReactNode } from 'react';
import { View } from 'react-native';

import { radius, spacing, useThemeColors } from '@/theme';

type Props = {
  children?: ReactNode;
  placement?: 'overlay' | 'below';
};

/** Shared metadata capsule, over media or in normal flow below emoji artwork.
 * Overlays keep equal 6px trailing and bottom insets. */
export function MessageMetaOverlay({ children, placement = 'overlay' }: Props) {
  const c = useThemeColors();
  if (!children) return null;

  return (
    <View
      style={{
        ...(placement === 'overlay'
          ? { position: 'absolute' as const, end: 6, bottom: 6 }
          : { alignSelf: 'flex-end' as const, marginTop: -spacing.xs }),
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
