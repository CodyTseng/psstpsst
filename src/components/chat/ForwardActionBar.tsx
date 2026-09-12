import { Forward } from '@solar-icons/react-native/category/arrows-action/Linear/Forward';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { bottomBarHeight, useThemeColors } from '@/theme';

type Props = {
  count: number;
  onForward: () => void;
};

/**
 * Bottom bar shown while the chat is in selection mode (forwarding) — the
 * actions area that replaces the composer. Same structure/height as `ChatInput`
 * (a `bottomBarHeight` bar + top hairline + safe-area spacer) so the list never
 * shifts when the bars swap. The action is a **`surface` `IconButton`** — the
 * same control as the composer's attachment (＋) button, so it reads as native
 * to the chat rather than a heavy primary slab. (The count lives in the header.)
 */
export function ForwardActionBar({ count, onForward }: Props) {
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
      </View>
      {/* Match ChatInput's resting bottom panel (the safe-area space). */}
      <View style={{ height: safe }} />
    </View>
  );
}
