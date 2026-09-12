import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { UserPlusRounded as UserPlus } from '@solar-icons/react-native/category/users/Linear/UserPlusRounded';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  onAdd: () => void;
  onBlock: () => void;
};

/**
 * Slim bar under the chat header for a 1:1 counterparty who isn't a saved
 * contact yet — the low-friction decision point for a fresh thread. Two
 * equal-width tap targets, each on its own soft fill so the choice reads at a
 * glance: **Add** (accent `UserPlus` on `accentSoft`) saves them to the address
 * book; **Block** (danger `Ban` on `dangerSoft`) drops them and their
 * conversation. The two fills meet edge-to-edge — no divider needed. The header
 * already shows who the peer is, so the labels stay short to fit the split. Not
 * hand-dismissible — it disappears on its own once the contact is saved (the
 * live `useContact` query flips) or the peer is blocked (the conversation is
 * soft-deleted and this screen is left).
 */
export function ChatContactPrompt({ onAdd, onBlock }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Pressable
        onPress={onAdd}
        fallbackHoverOpacity={false}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: uiDensity.chatNoticeVerticalPadding,
          backgroundColor: c.accentSoft,
        }}
      >
        {({ pressed }) => (
          <>
            {pressed ? <InteractionOverlay /> : null}
            <UserPlus size={16} color={c.accent} />
            <AppText variant="caption" weight="semibold" tone="accent" numberOfLines={1}>
              {t('chat.add_to_contacts')}
            </AppText>
          </>
        )}
      </Pressable>
      <Pressable
        onPress={onBlock}
        fallbackHoverOpacity={false}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: uiDensity.chatNoticeVerticalPadding,
          backgroundColor: c.dangerSoft,
        }}
      >
        {({ pressed }) => (
          <>
            {pressed ? <InteractionOverlay /> : null}
            <Ban size={16} color={c.danger} />
            <AppText
              variant="caption"
              weight="semibold"
              numberOfLines={1}
              style={{ color: c.danger }}
            >
              {t('chat.block')}
            </AppText>
          </>
        )}
      </Pressable>
    </View>
  );
}
