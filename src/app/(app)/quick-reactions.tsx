import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { QuickReactionsEditor } from '@/components/chat/QuickReactionsEditor';
import { useScrolled } from '@/hooks/use-scrolled';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { quickReactionKey } from '@/lib/nostr/quick-reaction';
import { useActiveAccount } from '@/stores/active-account.store';
import {
  DEFAULT_QUICK_EMOJIS,
  useReactionPrefsStore,
} from '@/stores/reaction-prefs.store';

/**
 * Quick reactions — pick the emoji shown in a message's long-press reaction
 * pill. A device-level preference (cf. chats.tsx); tap a tile to swap it, or
 * reset the whole set to the defaults.
 */
export default function QuickReactionsSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const emojiCollection = useCustomEmojis(accountPubkey);
  const quickEmojis = useReactionPrefsStore((s) => s.quickEmojis);
  const setQuickEmojis = useReactionPrefsStore((s) => s.setQuickEmojis);
  const titleClearance = useScreenHeaderClearance();

  const isDefault =
    quickEmojis.length === DEFAULT_QUICK_EMOJIS.length &&
    quickEmojis.every(
      (reaction, index) =>
        quickReactionKey(reaction) ===
        quickReactionKey(DEFAULT_QUICK_EMOJIS[index]),
    );

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: titleClearance + 8, paddingBottom: 32, gap: 16 }}
      >
        <QuickReactionsEditor
          value={quickEmojis}
          onChange={setQuickEmojis}
          customPacks={emojiCollection.packs}
          standaloneCustomEmojis={emojiCollection.standalone}
        />

        <AppText variant="caption" tone="muted" style={{ paddingHorizontal: 4 }}>
          {t('chats.quick_reactions_note')}
        </AppText>

        <AppButton
          variant="ghost"
          label={t('chats.quick_reactions_reset')}
          disabled={isDefault}
          onPress={() => setQuickEmojis(DEFAULT_QUICK_EMOJIS)}
        />
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('chats.quick_reactions')} />
    </AppScreen>
  );
}
