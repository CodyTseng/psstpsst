import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useApplicationRunning } from '@/stores/application-presence.store';
import { radius, spacing, useThemeColors } from '@/theme';
import { APPLICATION_ICON_SIZE, ApplicationIcon } from './ApplicationIcon';

export function RunningApplicationIcon({ sourceId, ...props }: ComponentProps<typeof ApplicationIcon> & { sourceId?: string }) {
  const running = useApplicationRunning(sourceId), colors = useThemeColors();
  const compact = (props.size ?? APPLICATION_ICON_SIZE) < spacing['3xl'];
  const dotSize = compact ? spacing.sm : spacing.md;
  return <View style={{ alignSelf: 'center', paddingHorizontal: spacing.xs }}>
    <ApplicationIcon {...props}/>
    {running ? <View testID="application-running-dot" style={{ position: 'absolute', bottom: -spacing.xs, end: 0,
      width: dotSize + spacing.xs, height: dotSize + spacing.xs, borderRadius: radius.full, backgroundColor: colors.success,
      borderWidth: 2, borderColor: colors.background , pointerEvents: 'none' }}/>:null}
  </View>;
}
