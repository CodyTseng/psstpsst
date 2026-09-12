import { View } from 'react-native';

import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { shadow, spacing, useThemeColors } from '@/theme';

type Props = {
  label: string;
  icon: React.ReactNode;
  onPress?: () => void;
  size?: number;
  width?: number;
  disabled?: boolean;
};

export const roundOverlayActionLabelHeight = 18;
export const roundOverlayActionGap = spacing.xs;

export function RoundOverlayAction({ label, icon, onPress, size = 64, width = 88, disabled }: Props) {
  const c = useThemeColors();

  return (
    <View style={{ alignItems: 'center', gap: roundOverlayActionGap, width }}>
      <IconButton
        variant="overlay"
        shape="circle"
        size={size}
        onPress={onPress}
        disabled={disabled}
        hitSlop={{ top: spacing.sm, bottom: spacing['2xl'], left: spacing.sm, right: spacing.sm }}
        icon={icon}
        accessibilityLabel={label}
      />
      <AppText
        variant="caption"
        weight="semibold"
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={[{ color: c.onOverlay, maxWidth: '100%' }, shadow.mediaText]}
      >
        {label}
      </AppText>
    </View>
  );
}
