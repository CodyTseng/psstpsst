import { router } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { DownloadMinimalistic as Download } from '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { ListRow } from '@/components/common/ListRow';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { ConversationListItem } from '@/components/conversation/ConversationListItem';
import { useScrolled } from '@/hooks/use-scrolled';
import { useRequestConversations } from '@/hooks/use-conversations';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { closeOpenSwipeable } from '@/lib/gestures';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
import { markAllRequestConversationsAsRead } from '@/services/conversation/conversation-read.service';
import { setConversationMuted } from '@/services/conversation/conversation-prefs.service';
import { dmService } from '@/services/dm/dm.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';
import { useUnreadIndicatorsEnabled } from '@/stores/unread-count.store';
import { spacing, typography, useThemeColors } from '@/theme';

export default function SearchUser() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { conversations: requestItems } = useRequestConversations(accountPubkey ?? '');
  const unreadIndicatorsEnabled = useUnreadIndicatorsEnabled();

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const inputRef = useFocusAfterTransition();
  const hasUnreadRequests = useMemo(
    () =>
      unreadIndicatorsEnabled &&
      requestItems.some((item) => item.conversation.unreadCount > 0),
    [requestItems, unreadIndicatorsEnabled],
  );
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );

  async function resolveUserInput(raw: string): Promise<string> {
    const result = await resolveNostrUserInput(raw);
    if (result.status === 'resolved') return result.pubkey;
    throw new Error(
      t(
        result.status === 'nip05_not_found'
          ? 'add_contact.nip05_not_found'
          : 'add_contact.invalid',
      ),
    );
  }

  async function openProfile(raw: string) {
    setError(null);
    if (!accountPubkey) return;
    setLoading(true);
    try {
      const pubkey = await resolveUserInput(raw);
      router.push(`/profile/${encodeURIComponent(pubkey)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleScanned(data: string) {
    setInput(data);
    void openProfile(data);
  }

  function openRequestConversation(conversationKey: string) {
    inputRef.current?.blur();
    router.push(`/chat/${encodeURIComponent(conversationKey)}?from=requests`);
  }

  async function markAllRequestsRead() {
    if (!accountPubkey || !hasUnreadRequests || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await markAllRequestConversationsAsRead(accountPubkey);
    } catch {
      showToast(t('contacts.mark_all_read_failed'));
    } finally {
      setMarkingAllRead(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={KEYBOARD_AVOIDING_BEHAVIOR}
      >
        <FlatList
          {...scrollProps}
          data={requestItems}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Scrolling dismisses an open row swipe menu (a row tap does too,
          // via the shared single-open registry).
          onScrollBeginDrag={() => closeOpenSwipeable()}
          ListHeaderComponent={
            <>
              <Pressable
                onPress={() => closeOpenSwipeable()}
                accessible={false}
                style={{ paddingHorizontal: spacing.lg, paddingTop: titleClearance + spacing.sm, gap: spacing.xl }}
              >
                <AppInput
                  ref={inputRef}
                  placeholder={t('add_contact.placeholder')}
                  description={t('add_contact.subtitle')}
                  error={error ?? undefined}
                  value={input}
                  onChangeText={(v) => {
                    setInput(v);
                    if (error) setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  trailingAccessory={<QrScanButton onScanned={handleScanned} />}
                />

                <AppButton
                  label={t('add_contact.add')}
                  variant="primary"
                  size="lg"
                  loading={loading}
                  disabled={!input.trim()}
                  onPress={() => void openProfile(input)}
                />

                <ListRow
                  icon={<Download size={22} color={c.textMuted} />}
                  title={t('add_contact.import_nostr')}
                  subtitle={t('add_contact.import_nostr_hint')}
                  subtitleMultiline
                  trailing={<ChevronRight size={18} color={c.textMuted} />}
                  onPress={() => router.push('/import-nostr-contacts')}
                />
              </Pressable>
              {requestItems.length > 0 ? (
                <Pressable
                  onPress={() => closeOpenSwipeable()}
                  accessible={false}
                  style={{
                    marginTop: spacing.xl,
                    paddingHorizontal: spacing.sm,
                    paddingBottom: spacing.xs,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: typography.caption.lineHeight,
                  }}
                >
                  <SectionLabel weight="semibold" style={{ marginStart: spacing.sm }}>
                    {t('contacts.requests_title')}
                  </SectionLabel>
                  {hasUnreadRequests ? (
                    <AppButton
                      label={t('contacts.mark_all_read')}
                      variant="accentText"
                      labelVariant="caption"
                      fullWidth={false}
                      loading={markingAllRead}
                      onPress={() => void markAllRequestsRead()}
                    />
                  ) : null}
                </Pressable>
              ) : null}
            </>
          }
          ListFooterComponentStyle={{ flexGrow: 1 }}
          ListFooterComponent={
            <Pressable
              onPress={() => closeOpenSwipeable()}
              accessible={false}
              style={{ flex: 1 }}
            />
          }
          keyExtractor={(item) => item.conversation.conversationKey}
          renderItem={({ item }) => {
            const conv = item.conversation;
            return (
              <ConversationListItem
                conversationKey={conv.conversationKey}
                counterpartyPubkey={conv.conversationKey}
                conversationName={conv.name}
                lastMessagePreview={
                  item.lastMessageKind === 15
                    ? attachmentLabel(item.lastMessageTags, attachmentLabels)
                    : item.lastMessageContent
                }
                lastMessageTags={item.lastMessageTags}
                lastMessageFromSelf={item.lastMessageSenderPubkey === accountPubkey}
                lastMessageAt={conv.lastMessageAt}
                unreadCount={unreadIndicatorsEnabled ? conv.unreadCount : 0}
                muted={conv.muted}
                onPress={() => openRequestConversation(conv.conversationKey)}
                onToggleMute={() => {
                  if (accountPubkey)
                    void setConversationMuted(accountPubkey, conv.conversationKey, !conv.muted);
                }}
                onDelete={() => {
                  if (accountPubkey)
                    void dmService.deleteConversation(accountPubkey, conv.conversationKey);
                }}
              />
            );
          }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.lg }}
        />
      </KeyboardAvoidingView>
      <ScreenHeader title={t('add_contact.title')} bordered={scrolled} />
    </AppScreen>
  );
}
