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
  /** One optional IconButton using the standard title-bar action sizing. */
  action?: React.ReactNode;
};

/**
 * Fixed task/detail-sheet chrome. The title is centered against the full sheet,
 * independently of the close and trailing-action widths, matching ScreenHeader.
 */
export function SheetHeader({ title, onClose, action }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <View
      style={{
        height: uiDensity.headerActionSize + spacing.sm,
        justifyContent: 'center',
        pointerEvents: 'box-none',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          start: 0,
          end: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing['3xl'] + spacing.xl,
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
          top: 0,
          start: 0,
          end: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.sm,
          pointerEvents: 'box-none',
        }}
      >
        <IconButton
          variant="plain"
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
