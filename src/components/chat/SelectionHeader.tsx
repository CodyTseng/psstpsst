import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { headerHeight, useThemeColors } from '@/theme';

type Props = {
  count: number;
  onCancel: () => void;
};

/**
 * Header shown while the chat is in selection mode (forwarding): a left "Cancel"
 * and a centered "N selected", at the same 56px height as `ChatHeader` so the
 * swap doesn't shift the list.
 */
export function SelectionHeader({ count, onCancel }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        height: headerHeight + insets.top,
        justifyContent: 'center',
        paddingTop: insets.top,
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        zIndex: 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <ChromeBackdrop scrollbarOcclusion="top" />
      {/* Centered count, behind the (left-aligned) cancel button. */}
      <View
        style={{ position: 'absolute', left: 0, right: 0, top: insets.top, bottom: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
      >
        <AppText variant="subtitle" weight="semibold" style={{ userSelect: 'none' }}>
          {t('chat.selected_count', { count })}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
        <AppButton variant="ghost" label={t('common.cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}
