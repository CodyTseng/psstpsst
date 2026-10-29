import { View } from 'react-native';
import { radius, spacing, useThemeColors } from '@/theme';

/** Determinate progress; callers use an activity indicator when the total is unknown. */
export function AppProgressBar({ value, label }: { value: number; label: string }) {
  const c = useThemeColors();
  const percent = Math.floor(Math.max(0, Math.min(1, value)) * 100);
  return <View accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: percent }}
    style={{ width: '100%', height: spacing.xs, borderRadius: radius.full, backgroundColor: c.insetFill, overflow: 'hidden' }}>
    <View style={{ width: `${percent}%`, height: '100%', backgroundColor: c.accent }} />
  </View>;
}
