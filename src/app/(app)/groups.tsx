import { router, useIsFocused } from 'expo-router';
import { UsersGroupRounded as UsersGroup } from '@solar-icons/react-native/category/users/Linear/UsersGroupRounded';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ConversationListItem } from '@/components/conversation/ConversationListItem';
import { useSavedGroups } from '@/hooks/use-common-groups';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { useScrolled } from '@/hooks/use-scrolled';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import { useActiveAccount } from '@/stores/active-account.store';
import { useUnreadIndicatorsEnabled } from '@/stores/unread-count.store';
import { contentWidth, spacing, uiDensity, useThemeColors } from '@/theme';

const ignoreRowAction = () => {};

export default function GroupsScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { groups, loaded } = useSavedGroups(accountPubkey);
  const unreadEnabled = useUnreadIndicatorsEnabled();
  const focused = useIsFocused();
  const currentMinute = useMinuteClock(focused);
  const clearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );

  return (
    <AppScreen edges={['bottom']}>
      {loaded ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.conversation.conversationKey}
          contentContainerStyle={{
            flexGrow: groups.length === 0 ? 1 : undefined,
            paddingTop: clearance,
            paddingBottom: spacing.lg,
          }}
          {...scrollProps}
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                marginStart:
                  spacing.lg + uiDensity.conversationAvatarSize + spacing.md,
                backgroundColor: c.border,
              }}
            />
          )}
          ListEmptyComponent={(
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.md,
                padding: spacing.xl,
              }}
            >
              <UsersGroup size={uiDensity.contactAvatarSize} color={c.textMuted} />
              <AppText variant="subtitle" tone="muted" align="center" weight="semibold">
                {t('group.list_empty_title')}
              </AppText>
              <AppText
                variant="body"
                tone="subtle"
                align="center"
                style={{ maxWidth: contentWidth.dialog }}
              >
                {t('group.list_empty_hint')}
              </AppText>
            </View>
          )}
          renderItem={({ item }) => {
            const conversation = item.conversation;
            return (
              <ConversationListItem
                conversationKey={conversation.conversationKey}
                counterpartyPubkey={null}
                conversationName={conversation.name}
                groupMemberPubkeys={conversation.memberPubkeys ?? []}
                lastMessagePreview={
                  item.lastMessageKind === 15
                    ? attachmentLabel(item.lastMessageTags, attachmentLabels)
                    : item.lastMessageContent
                }
                lastMessageTags={item.lastMessageTags}
                lastMessageFromSelf={item.lastMessageSenderPubkey === accountPubkey}
                lastMessageSenderPubkey={item.lastMessageSenderPubkey}
                lastMessageAt={conversation.lastMessageAt}
                currentMinute={currentMinute}
                unreadCount={unreadEnabled ? conversation.unreadCount : 0}
                muted={conversation.muted}
                pinned={conversation.pinned}
                onPress={(key) => router.push(`/chat/${encodeURIComponent(key)}`)}
                onToggleMute={ignoreRowAction}
                onDelete={ignoreRowAction}
                rowActionsEnabled={false}
              />
            );
          }}
        />
      ) : (
        <View style={{ flex: 1, paddingTop: clearance }} />
      )}
      <ScreenHeader bordered={scrolled} title={t('group.list_title')} />
    </AppScreen>
  );
}
