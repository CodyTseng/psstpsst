import dayjs from 'dayjs';
import Check from 'lucide-react-native/icons/check';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { radius, spacing } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { messageMetadataTypography } from '@/theme/typography';
import type { ThemeColors } from '@/theme/palette';

import { BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL, MESSAGE_DELIVERY_ICON_SIZE, MESSAGE_META_GAP } from './bubble-layout';

type Props = {
  colors: Pick<ThemeColors, 'accentForeground' | 'accentForegroundMuted'>;
  backgroundStyle: ComponentProps<typeof Animated.View>['style'];
};

/** Preview unsaved choices using the same geometry and metadata as sent messages. */
export function MessageAppearancePreview({ colors, backgroundStyle }: Props) {
  const { t } = useTranslation();
  const [time] = useState(() => dayjs().format('HH:mm'));
  return (
    <View testID="message-appearance-preview">
      <Animated.View style={[{
        alignSelf: 'flex-end', maxWidth: '100%', borderRadius: radius.lg,
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: BUBBLE_PADDING_HORIZONTAL, paddingVertical: BUBBLE_PADDING_VERTICAL,
        gap: spacing.xs,
      }, backgroundStyle]}>
        <AppText variant="message" numberOfLines={1} style={{ color: colors.accentForeground, flexShrink: 1,
          includeFontPadding: false, textAlignVertical: 'center' }}>
          {t('appearance.messagePreview')}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: MESSAGE_META_GAP }}>
          <AppText variant="caption" weight="regular" style={{ color: colors.accentForegroundMuted,
            ...messageMetadataTypography, includeFontPadding: false, textAlignVertical: 'center' }}>{time}</AppText>
          <Check strokeWidth={iconStrokeWidth.compact} size={MESSAGE_DELIVERY_ICON_SIZE} color={colors.accentForegroundMuted} />
        </View>
      </Animated.View>
    </View>
  );
}
