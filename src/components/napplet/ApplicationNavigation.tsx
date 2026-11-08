import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/common/IconButton';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

export const APPLICATION_NAVIGATION_WIDTH = uiDensity.headerActionSize * 2 + spacing.xs;

export function ApplicationNavigation({ enabled, canGoBack, canGoForward, onBack, onForward }: {
  enabled: boolean; canGoBack: boolean; canGoForward: boolean; onBack(): void; onForward(): void;
}) {
  const { t } = useTranslation(), c = useThemeColors(), direction = useDirectionalIconStyle();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
    <IconButton size={uiDensity.headerActionSize} accessibilityLabel={t('common.back')} disabled={!enabled || !canGoBack} onPress={onBack}
      icon={<ChevronLeft size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={enabled && canGoBack ? c.text : c.textMuted} style={direction} />} />
    <IconButton size={uiDensity.headerActionSize} accessibilityLabel={t('applications.runtime_forward')} disabled={!enabled || !canGoForward} onPress={onForward}
      icon={<ChevronRight size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={enabled && canGoForward ? c.text : c.textMuted} style={direction} />} />
  </View>;
}
