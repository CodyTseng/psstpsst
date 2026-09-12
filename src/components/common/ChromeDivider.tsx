import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';

/** Overlays a chrome boundary without changing the content or viewport size. */
export function ChromeDivider({
  visible,
  edge = 'bottom',
}: {
  visible: boolean;
  edge?: 'top' | 'bottom';
}) {
  const c = useThemeColors();
  if (!visible) return null;
  return (
    <View
      style={{
        position: 'absolute',
        [edge]: 0,
        start: 0,
        end: 0,
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.border,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
}
