import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Keyboard, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { SearchResultRow } from '@/components/search/SearchResultRow';
import { useConversationSearch } from '@/hooks/use-conversation-search';
import {
  MIN_MESSAGE_QUERY,
  type MessageSearchHit,
  useMessageSearch,
} from '@/hooks/use-message-search';
import type { ConversationWithLast } from '@/hooks/use-conversations';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import { bottomBarHeight, spacing, useThemeColors } from '@/theme';

type ConvRow = { kind: 'conv'; item: ConversationWithLast };
type MsgRow = { kind: 'msg'; item: MessageSearchHit };
type Section =
  | { title: string; kind: 'conv'; data: ConvRow[] }
  | { title: string; kind: 'msg'; data: MsgRow[] };

/**
 * The Chats-tab search results: two sections — name-matched **conversations**
 * and full-text **messages** (only the sections with hits appear). Quiet blank
 * while a message search is still running (DESIGN §11 no-flash); "no results"
 * only once everything has settled empty.
 */
export function GlobalSearchResults({
  accountPubkey,
  query,
}: {
  accountPubkey: string;
  query: string;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { open: openInDetailPane } = usePrimaryPaneNavigation();
  const bottomClearance = bottomBarHeight + insets.bottom;
  const conversationHits = useConversationSearch(accountPubkey, query);
  const {
    results: messageHits,
    searching,
    loadingMore,
    loadMore,
  } = useMessageSearch(accountPubkey, query);
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (conversationHits.length > 0) {
      out.push({
        title: t('search.section_chats'),
        kind: 'conv',
        data: conversationHits.map((item) => ({ kind: 'conv', item })),
      });
    }
    if (messageHits.length > 0) {
      out.push({
        title: t('search.section_messages'),
        kind: 'msg',
        data: messageHits.map((item) => ({ kind: 'msg', item })),
      });
    }
    return out;
  }, [conversationHits, messageHits, t]);

  const q = query.trim();
  const empty = sections.length === 0;
  // While the (async) message search is still running, hold a blank rather than
  // flash "no results" mid-type. Conversation hits are synchronous.
  const settledEmpty = empty && !searching;

  return (
    <SectionList<ConvRow | MsgRow, Section>
      sections={sections}
      contentContainerStyle={{ paddingBottom: bottomClearance }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={() => Keyboard.dismiss()}
      keyExtractor={(row) =>
        row.kind === 'conv' ? `c:${row.item.conversation.conversationKey}` : `m:${row.item.id}`
      }
      renderSectionHeader={({ section }) => (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            backgroundColor: c.background,
          }}
        >
          <AppText variant="caption" tone="muted" weight="semibold">
            {section.title}
          </AppText>
        </View>
      )}
      renderItem={({ item: row }) => {
        if (row.kind === 'conv') {
          const conv = row.item.conversation;
          // conversation_key IS the counterparty pubkey.
          const counterparty = conv.conversationKey;
          const preview =
            row.item.lastMessageKind === 15
              ? attachmentLabel(row.item.lastMessageTags, attachmentLabels)
              : row.item.lastMessageContent;
          return (
            <SearchResultRow
              counterpartyPubkey={counterparty}
              conversationName={conv.name}
              subtitle={preview}
              timestamp={conv.lastMessageAt}
              onPress={() =>
                openInDetailPane(`/chat/${encodeURIComponent(conv.conversationKey)}`)
              }
            />
          );
        }
        const hit = row.item;
        // conversation_key IS the counterparty pubkey.
        const counterparty = hit.conversationKey;
        return (
          <SearchResultRow
            counterpartyPubkey={counterparty}
            avatarPubkey={hit.senderPubkey}
            conversationName={null}
            subtitle={hit.snippet}
            boldSnippet
            timestamp={hit.createdAt}
            onPress={() =>
              openInDetailPane(
                `/chat/${encodeURIComponent(hit.conversationKey)}?focus=${encodeURIComponent(
                  hit.id,
                )}&focusOrderAt=${hit.orderAt}`,
              )
            }
          />
        );
      }}
      onEndReached={() => loadMore()}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        loadingMore ? (
          <View style={{ padding: 16 }}>
            <ActivityIndicator color={c.textMuted} />
          </View>
        ) : q.length > 0 && q.length < MIN_MESSAGE_QUERY ? (
          <View style={{ padding: 16 }}>
            <AppText variant="caption" tone="subtle" align="center">
              {t('search.min_chars_hint')}
            </AppText>
          </View>
        ) : null
      }
      ListEmptyComponent={
        settledEmpty && q.length > 0 ? (
          <View style={{ paddingTop: 48, alignItems: 'center' }}>
            <AppText variant="body" tone="muted">
              {t('search.empty')}
            </AppText>
          </View>
        ) : null
      }
    />
  );
}
