import { DownloadMinimalistic as Download } from '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic';
import X from 'lucide-react-native/icons/x';
import Minus from 'lucide-react-native/icons/minus';
import Plus from 'lucide-react-native/icons/plus';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { IMAGE_MAX_SCALE, type ZoomableImageHandle } from '@/components/common/ZoomableImage';
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type ExtraAction = {
  accessibilityLabel: string;
  icon: ReactNode;
  onPress: () => void;
};

type Props = {
  disabled?: boolean;
  extraAction?: ExtraAction;
  imageZoom?: ZoomableImageHandle & { scale: number };
  onClose: () => void;
  onSave: () => void;
};

/** Shared lightbox chrome: close at start, optional context action and save at end. */
export function MediaViewerTopBar({ disabled, extraAction, imageZoom, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + spacing.sm,
        start: 0,
        end: 0,
        paddingHorizontal: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        pointerEvents: 'box-none',
      }}
    >
      <IconButton
        variant="overlay"
        size={uiDensity.headerActionSize}
        onPress={onClose}
        hitSlop={spacing.sm}
        icon={<X strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.onOverlay} />}
        accessibilityLabel={t('common.close')}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {IS_ELECTRON && imageZoom ? (
          <>
            <IconButton
              variant="overlay"
              size={uiDensity.headerActionSize}
              onPress={imageZoom.zoomOut}
              disabled={imageZoom.scale <= 1}
              hitSlop={spacing.sm}
              icon={<Minus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.onOverlay} />}
              accessibilityLabel={t('emoji.zoom_out')}
            />
            <IconButton
              variant="overlay"
              size={uiDensity.headerActionSize}
              onPress={imageZoom.zoomIn}
              disabled={imageZoom.scale === 0 || imageZoom.scale >= IMAGE_MAX_SCALE}
              hitSlop={spacing.sm}
              icon={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.onOverlay} />}
              accessibilityLabel={t('emoji.zoom_in')}
            />
          </>
        ) : null}
        {extraAction ? (
          <IconButton
            variant="overlay"
            size={uiDensity.headerActionSize}
            onPress={extraAction.onPress}
            hitSlop={spacing.sm}
            icon={extraAction.icon}
            accessibilityLabel={extraAction.accessibilityLabel}
          />
        ) : null}
        <IconButton
          variant="overlay"
          size={uiDensity.headerActionSize}
          onPress={onSave}
          disabled={disabled}
          hitSlop={spacing.sm}
          icon={<Download size={uiDensity.headerActionIconSize} color={c.onOverlay} />}
          accessibilityLabel={t('attach.save')}
        />
      </View>
    </View>
  );
}
