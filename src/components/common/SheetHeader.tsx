import X from 'lucide-react-native/icons/x';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

type Props = {
  title: string;
  onClose: () => void;
  showHandle?: boolean;
  /** One optional secondary IconButton (accent for Done), with title-bar sizing. */
  action?: React.ReactNode;
};

/**
 * Fixed task/detail-sheet chrome. The title is centered against the full sheet,
 * independently of the close and trailing-action widths, matching ScreenHeader.
 */
export function SheetHeader({ title, onClose, action, showHandle = true }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  // The compact grabber already occupies sm + xs above this header.
  const topInset = showHandle ? spacing.xs : spacing.lg;

  return (
    <View
      style={{
        height: topInset + uiDensity.headerActionSize + spacing.sm,
        justifyContent: 'center',
        pointerEvents: 'box-none',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: topInset,
          start: 0,
          end: 0,
          bottom: spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg + uiDensity.headerActionSize + spacing.sm,
          pointerEvents: 'none',
        }}
      >
        <AppText
          variant="subtitle"
          weight="semibold"
          align="center"
          numberOfLines={1}
          accessibilityRole="header"
          style={{ userSelect: 'none' }}
        >
          {title}
        </AppText>
      </View>

      <View
        style={{
          position: 'absolute',
          top: topInset,
          start: 0,
          end: 0,
          bottom: spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          pointerEvents: 'box-none',
        }}
      >
        <IconButton
          variant="secondary"
          size={uiDensity.headerActionSize}
          onPress={onClose}
          icon={<X strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
          accessibilityLabel={t('common.close')}
        />
        {action ? (
          <View style={{ height: uiDensity.headerActionSize, justifyContent: 'center' }}>
            {action}
          </View>
        ) : (
          <View style={{ width: uiDensity.headerActionSize }} />
        )}
      </View>
    </View>
  );
}
