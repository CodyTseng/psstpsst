import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations, messages } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import type { ConversationWithLast } from '@/hooks/use-conversations';

export function useCommonGroups(
  accountPubkey: string,
  memberPubkey: string,
): { groups: ConversationWithLast[]; loaded: boolean } {
  const { data, isResolved } = useLiveQuery(
    db
      .select({
        conversation: conversations,
        lastMessageContent: messages.content,
        lastMessageKind: messages.kind,
        lastMessageTags: messages.tags,
        lastMessageSenderPubkey: messages.senderPubkey,
      })
      .from(conversations)
      .leftJoin(
        messages,
        and(
          eq(messages.accountPubkey, conversations.accountPubkey),
          eq(messages.id, conversations.lastMessageId),
        ),
      )
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.deleted, false),
          isNotNull(conversations.groupId),
          isNotNull(conversations.membersBootstrapEventId),
        ),
      )
      .orderBy(desc(conversations.updatedOrderAt), desc(conversations.conversationKey)),
    [accountPubkey, memberPubkey, 'common-groups'],
  );
  const groups = (data ?? []).filter(({ conversation }) => {
    const members = conversation.memberPubkeys ?? [];
    return members.includes(accountPubkey) && members.includes(memberPubkey);
  });
  return { groups, loaded: isResolved };
}
