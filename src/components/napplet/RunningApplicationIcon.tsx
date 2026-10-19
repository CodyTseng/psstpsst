import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApplicationRunning } from '@/stores/application-presence.store';
import { radius, spacing, useThemeColors } from '@/theme';
import { NappletIcon } from './NappletIcon';

export function RunningApplicationIcon({ sourceId, ...props }: ComponentProps<typeof NappletIcon> & { sourceId?: string }) {
  const running = useApplicationRunning(sourceId), colors = useThemeColors();
  return <View style={{ paddingHorizontal: spacing.xs }}>
    <NappletIcon {...props}/>
    {running ? <View pointerEvents="none" testID="application-running-dot" style={{ position: 'absolute', top: spacing.xs, end: 0,
      width: spacing.sm, height: spacing.sm, borderRadius: radius.full, backgroundColor: colors.success,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.background }}/>:null}
  </View>;
}
