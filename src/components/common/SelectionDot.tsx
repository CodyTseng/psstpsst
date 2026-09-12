import { View } from 'react-native';

import { radius, spacing, useThemeColors } from '@/theme';

/**
 * The multi-select indicator: a hollow ring when unselected, a filled accent
 * circle with a background-colour centre when selected. Shared by recipient
 * picker rows and the chat's selection-mode message column so selection reads
 * identically without stacking a circled icon inside the outer ring.
 */
export function SelectionDot({ selected }: { selected: boolean }) {
  const c = useThemeColors();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 0 : 1.5,
        borderColor: c.border,
        backgroundColor: selected ? c.accent : 'transparent',
      }}
    >
      {selected ? (
        <View
          style={{
            width: spacing.sm,
            height: spacing.sm,
            borderRadius: radius.full,
            backgroundColor: c.background,
          }}
        />
      ) : null}
    </View>
  );
}
