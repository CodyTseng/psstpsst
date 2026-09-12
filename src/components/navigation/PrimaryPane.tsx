import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { getPrimaryPaneWidth } from '@/lib/layout/wide-layout';
import { useThemeColors } from '@/theme';

export type PrimaryPaneProps = { windowWidth: number; children: ReactNode };

export function PrimaryPane({ windowWidth, children }: PrimaryPaneProps) {
  const c = useThemeColors();
  return (
    <View style={{
      width: getPrimaryPaneWidth(windowWidth),
      borderEndWidth: StyleSheet.hairlineWidth,
      borderEndColor: c.border,
    }}>
      {children}
    </View>
  );
}
