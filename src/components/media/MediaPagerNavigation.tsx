import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconButton } from '@/components/common/IconButton';
import { useIsRTL } from '@/i18n/direction';
import { IS_ELECTRON } from '@/lib/platform';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

type Props = {
  hasPrevious: boolean;
  hasNext: boolean;
  disabled: boolean;
  onPage: (step: -1 | 1) => void;
};

/** Pointer and keyboard alternatives to swiping the desktop media pager. */
export function MediaPagerNavigation({ hasPrevious, hasNext, disabled, onPage }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const isRTL = useIsRTL();

  useEffect(() => {
    if (!IS_ELECTRON || typeof document === 'undefined') return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]')) return;
      // Keep arrow keys from scrolling the underlying chat, including at an end.
      event.preventDefault();
      event.stopImmediatePropagation();
      const step = (event.key === 'ArrowRight') !== isRTL ? 1 : -1;
      if (!disabled && (step === -1 ? hasPrevious : hasNext)) onPage(step);
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [disabled, hasPrevious, hasNext, isRTL, onPage]);

  if (!IS_ELECTRON) return null;
  const Previous = isRTL ? ChevronRight : ChevronLeft;
  const Next = isRTL ? ChevronLeft : ChevronRight;

  return (
    <View
      style={{
        position: 'absolute',
        top: '50%',
        start: spacing.lg,
        end: spacing.lg,
        marginTop: -uiDensity.headerActionSize / 2,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
      pointerEvents="box-none"
    >
      <View>{hasPrevious ? (
        <IconButton
          variant="overlay"
          size={uiDensity.headerActionSize}
          disabled={disabled}
          onPress={() => onPage(-1)}
          accessibilityLabel={t('media.previous')}
          icon={<Previous size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.onOverlay} />}
        />
      ) : null}</View>
      <View>{hasNext ? (
        <IconButton
          variant="overlay"
          size={uiDensity.headerActionSize}
          disabled={disabled}
          onPress={() => onPage(1)}
          accessibilityLabel={t('media.next')}
          icon={<Next size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.onOverlay} />}
        />
      ) : null}</View>
    </View>
  );
}
