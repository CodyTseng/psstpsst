import { router } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { Reply as CornerDownLeft } from '@solar-icons/react-native/category/arrows-action/Linear/Reply';
import { Box as Package } from '@solar-icons/react-native/category/ui/Linear/Box';
import { StickerSmileCircle2 as SmilePlus } from '@solar-icons/react-native/category/faces/Linear/StickerSmileCircle2';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { Toggle } from '@/components/common/Toggle';
import { NostrEventUrlSetting } from '@/components/settings/NostrEventUrlSetting';
import { IS_ELECTRON } from '@/lib/platform';
import { useChatPrefsStore } from '@/stores/chat-prefs.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { spacing, useThemeColors } from '@/theme';

/** Device-level composer, reaction, and embedded-note preferences. */
export default function ChatsSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const enterToSend = useChatPrefsStore((s) => s.enterToSend);
  const setEnterToSend = useChatPrefsStore((s) => s.setEnterToSend);

  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{ padding: spacing.lg, paddingTop: titleClearance + spacing.sm, gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <ListGroup>
            <ListRow
              icon={<CornerDownLeft size={22} color={c.text} />}
              title={t('chats.enter_to_send')}
              trailing={<Toggle value={enterToSend} onValueChange={setEnterToSend} />}
            />
          </ListGroup>
          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
            {t(
              IS_ELECTRON
                ? 'chats.enter_to_send_note_desktop'
                : 'chats.enter_to_send_note',
            )}
          </AppText>
        </View>

        <ListGroup>
          <ListRow
            icon={<SmilePlus size={22} color={c.text} />}
            title={t('chats.quick_reactions')}
            trailing={<ChevronRight size={18} color={c.textMuted} />}
            onPress={() => router.push('/quick-reactions')}
          />
          <ListRow
            icon={<Package size={22} color={c.text} />}
            title={t('emoji.packs_title')}
            trailing={<ChevronRight size={18} color={c.textMuted} />}
            onPress={() => router.push('/emoji-packs')}
          />
          <NostrEventUrlSetting />
        </ListGroup>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('settings.chats')} />
    </AppScreen>
  );
}
