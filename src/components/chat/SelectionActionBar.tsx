import { Forward } from '@solar-icons/react-native/category/arrows-action/Linear/Forward';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { bottomBarHeight, spacing, useThemeColors } from '@/theme';

type Props = {
  count: number;
  onForward: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
};

/** Replaces the composer at the same height while messages are selected. */
export function SelectionActionBar({ count, onForward, onDelete, deleteDisabled = false }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const enabled = count > 0;
  const safe = getBottomChromeInset(insets.bottom);

  return (
    <View style={{ marginTop: -(bottomBarHeight + safe), zIndex: 1 }}>
      <ChromeBackdrop scrollbarOcclusion="bottom" />
      <View
        style={{
          minHeight: bottomBarHeight,
          paddingHorizontal: 16,
          paddingTop: 8 - StyleSheet.hairlineWidth,
          paddingBottom: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing['3xl'],
        }}
      >
        <IconButton
          variant="surface"
          size={40}
          onPress={onForward}
          disabled={!enabled}
          accessibilityLabel={t('chat.actions.forward')}
          icon={<Forward size={22} color={c.text} />}
        />
        {onDelete ? (
          <IconButton
            variant="dangerSoft"
            size={40}
            onPress={onDelete}
            disabled={!enabled || deleteDisabled}
            accessibilityLabel={t('common.delete')}
            icon={<Trash2 size={22} color={c.danger} />}
          />
        ) : null}
      </View>
      {/* Match ChatInput's resting bottom panel (the safe-area space). */}
      <View style={{ height: safe }} />
    </View>
  );
}
