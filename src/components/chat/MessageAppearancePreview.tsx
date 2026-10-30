import dayjs from 'dayjs';
import Check from 'lucide-react-native/icons/check';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { radius, spacing } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { defaultThemePalettes, type ThemeColors } from '@/theme/palette';
import type { AccentMode } from '@/theme/accents';

import { BUBBLE_MAX_WIDTH, BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL, MESSAGE_DELIVERY_ICON_SIZE } from './bubble-layout';

type Props = {
  mode: AccentMode;
  colors: Pick<ThemeColors, 'accentForeground' | 'accentForegroundMuted'>;
  backgroundStyle: ComponentProps<typeof Animated.View>['style'];
};

/** Preview unsaved choices using the same geometry and metadata as sent messages. */
export function MessageAppearancePreview({ mode, colors, backgroundStyle }: Props) {
  const { t } = useTranslation();
  const [time] = useState(() => dayjs().format('HH:mm'));
  return (
    <View testID="message-appearance-preview" style={{ padding: spacing.md, borderRadius: radius.md,
      backgroundColor: defaultThemePalettes[mode].background }}>
      <Animated.View style={[{
        alignSelf: 'flex-end', maxWidth: BUBBLE_MAX_WIDTH, borderRadius: radius.lg,
        paddingHorizontal: BUBBLE_PADDING_HORIZONTAL, paddingVertical: BUBBLE_PADDING_VERTICAL,
        gap: spacing.xs,
      }, backgroundStyle]}>
        <AppText variant="message" style={{ color: colors.accentForeground }}>
          {t('appearance.messagePreview')}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: spacing.xs }}>
          <AppText variant="caption" style={{ color: colors.accentForegroundMuted }}>{time}</AppText>
          <Check strokeWidth={iconStrokeWidth.compact} size={MESSAGE_DELIVERY_ICON_SIZE} color={colors.accentForegroundMuted} />
        </View>
      </Animated.View>
    </View>
  );
}
