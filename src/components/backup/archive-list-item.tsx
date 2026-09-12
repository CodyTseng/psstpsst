import { FolderOpen } from '@solar-icons/react-native/category/folders/Linear/FolderOpen';
import { Archive } from '@solar-icons/react-native/category/notes/Linear/Archive';
import { TrashBinTrash as Trash2 } from '@solar-icons/react-native/category/ui/Linear/TrashBinTrash';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { IconButton } from '@/components/common/IconButton';
import { ListRow } from '@/components/common/ListRow';
import { SwipeAction, SWIPE_ACTION_WIDTH } from '@/components/common/swipe-action';
import { useIsRTL } from '@/i18n/direction';
import {
  BACK_SWIPE_GUARD,
  clearOpenSwipeable,
  closeIfOpen,
  closeOpenSwipeable,
  registerOpenSwipeable,
} from '@/lib/gestures';
import { radius, useThemeColors } from '@/theme';

type Props = {
  title: string;
  subtitle: string;
  value?: string;
  disabled?: boolean;
  onPress: () => void;
  onReveal?: () => void;
  onDelete: () => void;
};

/** Latest-backup row with the same trailing delete gesture as a conversation. */
export function ArchiveListItem({
  title,
  subtitle,
  value,
  disabled,
  onPress,
  onReveal,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const swipeableRef = useRef<Swipeable>(null);
  const closeSwipe = useCallback(() => swipeableRef.current?.close(), []);

  useEffect(
    () => () => {
      clearOpenSwipeable(closeSwipe);
    },
    [closeSwipe],
  );

  function renderRightActions() {
    return (
      <View style={{ width: SWIPE_ACTION_WIDTH, flexDirection: 'row' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: -radius.lg,
            end: 0,
            backgroundColor: c.danger,
            pointerEvents: 'none',
          }}
        />
        <SwipeAction
          onPress={() => {
            closeSwipe();
            onDelete();
          }}
          icon={<Trash2 size={20} color={c.onOverlay} />}
          label={t('common.delete')}
          color={c.onOverlay}
          bgRest={c.danger}
        />
      </View>
    );
  }

  return (
    <View
      style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surfaceElevated }}
    >
      <Swipeable
        ref={swipeableRef}
        enabled={!disabled}
        // RN Web has no native animated module; run the swipe on the JS
        // driver there so Animated stops warning about `useNativeDriver`.
        useNativeAnimations={Platform.OS !== 'web'}
        renderLeftActions={isRTL ? renderRightActions : undefined}
        renderRightActions={isRTL ? undefined : renderRightActions}
        leftThreshold={40}
        rightThreshold={40}
        friction={2}
        overshootLeft={false}
        overshootRight={false}
        hitSlop={isRTL ? { right: -BACK_SWIPE_GUARD } : { left: -BACK_SWIPE_GUARD }}
        onSwipeableWillOpen={() => registerOpenSwipeable(closeSwipe)}
        onSwipeableClose={() => {
          clearOpenSwipeable(closeSwipe);
        }}
      >
        <ListRow
          variant="embedded"
          icon={<Archive size={22} color={c.text} />}
          title={title}
          subtitle={subtitle}
          value={value}
          preserveColumn="value"
          trailing={
            onReveal ? (
              <IconButton
                variant="plain"
                icon={<FolderOpen size={20} color={c.text} />}
                onPress={(event) => {
                  event.stopPropagation();
                  onReveal();
                }}
                accessibilityLabel={t('backup.show_in_folder')}
              />
            ) : undefined
          }
          onPress={() => {
            if (closeIfOpen(closeSwipe)) return;
            closeOpenSwipeable();
            onPress();
          }}
          disabled={disabled}
        />
      </Swipeable>
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.lg,
          pointerEvents: 'none',
        }}
      />
    </View>
  );
}
