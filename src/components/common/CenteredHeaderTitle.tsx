import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Equal shrinking side rails keep titles centered even when no text fits. */
export function CenteredHeaderTitle({ sideInset, interactive = false, children }: {
  sideInset: number; interactive?: boolean; children: ReactNode;
}) {
  return <View style={[StyleSheet.absoluteFill, interactive ? styles.passThrough : styles.nonInteractive,
    { flexDirection: 'row', alignItems: 'center' }]}>
    <View style={{ pointerEvents: 'none', width: sideInset, flexShrink: 1 }} />
    <View style={[styles.passThrough, { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }]}>
      {children}
    </View>
    <View style={{ pointerEvents: 'none', width: sideInset, flexShrink: 1 }} />
  </View>;
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'box-none' },
  nonInteractive: { pointerEvents: 'none' },
});
