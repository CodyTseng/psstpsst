import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  onUnblock: () => void;
};

/**
 * Slim bar under the chat header shown when the 1:1 counterparty is blocked —
 * the in-chat marker for a blocked thread (blocking no longer deletes the
 * conversation). A `dangerSoft` tint with a `Ban` glyph states the situation;
 * a trailing accent "Unblock" tap target lifts the block. Replaces the
 * add/block `ChatContactPrompt` while blocked.
 */
export function ChatBlockedNotice({ onUnblock }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: uiDensity.chatNoticeVerticalPadding,
        backgroundColor: c.dangerSoft,
      }}
    >
      <Ban size={16} color={c.danger} />
      <AppText variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1, color: c.danger }}>
        {t('chat.blocked_notice')}
      </AppText>
      <Pressable onPress={onUnblock} hitSlop={8}>
        <AppText variant="caption" weight="semibold" tone="accent">
          {t('chat.unblock')}
        </AppText>
      </Pressable>
    </View>
  );
}
