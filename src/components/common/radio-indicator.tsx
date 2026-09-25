import { View } from 'react-native';

import { radius, useThemeColors } from '@/theme';

const RADIO_SIZE = 22;
const RADIO_DOT_SIZE = 10;
const RADIO_STROKE_WIDTH = 2;

/** Visual indicator for one choice in a radio list; the owning row carries semantics. */
export function RadioIndicator({ selected }: { selected: boolean }) {
  const c = useThemeColors();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: RADIO_SIZE,
        height: RADIO_SIZE,
        borderRadius: radius.full,
        borderWidth: RADIO_STROKE_WIDTH,
        borderColor: selected ? c.accent : c.textMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View
          style={{
            width: RADIO_DOT_SIZE,
            height: RADIO_DOT_SIZE,
            borderRadius: radius.full,
            backgroundColor: c.accent,
          }}
        />
      ) : null}
    </View>
  );
}
