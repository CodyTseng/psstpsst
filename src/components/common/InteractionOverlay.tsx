import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';

/** Shared hover/pressed layer above a resting fill and below its content. */
export function InteractionOverlay({
  borderRadius = 0,
}: {
  borderRadius?: number;
}) {
  const c = useThemeColors();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: c.interactionOverlay,
          borderRadius,
          pointerEvents: 'none',
        },
      ]}
    />
  );
}
