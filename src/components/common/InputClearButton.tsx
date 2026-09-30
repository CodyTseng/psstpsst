import X from 'lucide-react-native/icons/x';
import { useTranslation } from 'react-i18next';

import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

import { IconButton } from './IconButton';

export function InputClearButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <IconButton
      variant="plain"
      size={spacing.xl}
      hitSlop={spacing.sm}
      accessibilityLabel={t('search.clear')}
      onPress={onPress}
      icon={<X strokeWidth={iconStrokeWidth.default} size={16} color={c.textMuted} />}
    />
  );
}
