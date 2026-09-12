import X from 'lucide-react-native/icons/x';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { desktopChrome, spacing, useThemeColors } from '@/theme';

export function ScannerCloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const top = (IS_ELECTRON ? desktopChrome.titlebarHeight : insets.top) + spacing.sm;

  return (
    <IconButton
      variant="overlay"
      onPress={onClose}
      hitSlop={spacing.sm}
      style={{ position: 'absolute', top, start: spacing.lg }}
      icon={<X strokeWidth={iconStrokeWidth.default} size={20} color={c.onOverlay} />}
      accessibilityLabel={t('common.close')}
    />
  );
}
