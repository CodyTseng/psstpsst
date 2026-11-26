import X from 'lucide-react-native/icons/x';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDirectionalIconStyle } from '@/i18n/direction';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

type Props = {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  showHandle?: boolean;
  /** One optional title-bar action or passive account identity indicator. */
  action?: React.ReactNode;
};

/**
 * Fixed task/detail-sheet chrome. The title is centered against the full sheet,
 * independently of the close and trailing-action widths, matching ScreenHeader.
 */
export function SheetHeader({ title, onClose, onBack, action, showHandle = true }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const LeadingIcon = onBack ? ChevronLeft : X;
  // The compact grabber already occupies sm + xs above this header.
  const topInset = showHandle ? spacing.xs : spacing.lg;

  return (
    <View
      style={{
        height: topInset + uiDensity.headerActionSize + spacing.lg,
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
          bottom: spacing.lg,
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
          bottom: spacing.lg,
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
          onPress={onBack ?? onClose}
          icon={<LeadingIcon strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize}
            color={c.text} style={onBack ? directionalIconStyle : undefined} />}
          accessibilityLabel={t(onBack ? 'common.back' : 'common.close')}
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
