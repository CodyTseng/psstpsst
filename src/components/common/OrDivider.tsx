import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';

import { AppText } from './AppText';

/**
 * A hairline rule with a centered label ("or") that separates two alternative
 * actions — e.g. the primary action above and a secondary path below.
 */
export function OrDivider({ label }: { label: string }) {
  const c = useThemeColors();
  const line = { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={line} />
      <AppText variant="caption" tone="subtle">
        {label}
      </AppText>
      <View style={line} />
    </View>
  );
}
