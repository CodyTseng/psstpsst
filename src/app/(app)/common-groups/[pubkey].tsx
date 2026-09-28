import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ConversationListItem } from '@/components/conversation/ConversationListItem';
import { useCommonGroups } from '@/hooks/use-common-groups';
import { routeHexIdParam } from '@/lib/navigation/route-params';
import { useActiveAccount } from '@/stores/active-account.store';
import { useUnreadIndicatorsEnabled } from '@/stores/unread-count.store';

export default function CommonGroupsScreen() {
  const params = useLocalSearchParams<{ pubkey: string | string[] }>();
  const pubkey = routeHexIdParam(params.pubkey) ?? '';
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { groups, loaded } = useCommonGroups(accountPubkey, pubkey);
  const unreadEnabled = useUnreadIndicatorsEnabled();
  const clearance = useScreenHeaderClearance();
  const { t } = useTranslation();
  return (
    <AppScreen edges={['bottom']}>
      {loaded ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.conversation.conversationKey}
          contentContainerStyle={{ paddingTop: clearance }}
          renderItem={({ item }) => {
            const conversation = item.conversation;
            return (
              <ConversationListItem
                conversationKey={conversation.conversationKey}
                counterpartyPubkey={null}
                conversationName={conversation.name}
                groupMemberPubkeys={conversation.memberPubkeys}
                lastMessagePreview={item.lastMessageContent}
                lastMessageTags={item.lastMessageTags}
                lastMessageSenderPubkey={item.lastMessageSenderPubkey}
                lastMessageFromSelf={item.lastMessageSenderPubkey === accountPubkey}
                lastMessageAt={conversation.lastMessageAt}
                unreadCount={unreadEnabled ? conversation.unreadCount : 0}
                muted={conversation.muted}
                pinned={conversation.pinned}
                onPress={(key) => router.push(`/chat/${encodeURIComponent(key)}`)}
                onToggleMute={() => {}}
                onDelete={() => {}}
                rowActionsEnabled={false}
              />
            );
          }}
        />
      ) : (
        <View style={{ flex: 1, paddingTop: clearance }} />
      )}
      <ScreenHeader title={t('group.common_groups')} />
    </AppScreen>
  );
}
