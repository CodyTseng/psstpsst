import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { conversations, messages, savedGroups } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import type { ConversationWithLast } from '@/hooks/use-conversations';
import { rememberConversationSnapshot } from '@/lib/conversation/conversation-snapshot-cache';

function selectSavedGroups(accountPubkey: string) {
  return db
    .select({
      conversation: conversations,
      lastMessageContent: messages.content,
      lastMessageKind: messages.kind,
      lastMessageTags: messages.tags,
      lastMessageSenderPubkey: messages.senderPubkey,
    })
    .from(savedGroups)
    .innerJoin(
      conversations,
      and(
        eq(conversations.accountPubkey, savedGroups.accountPubkey),
        eq(conversations.groupId, savedGroups.groupId),
      ),
    )
    .leftJoin(
      messages,
      and(
        eq(messages.accountPubkey, conversations.accountPubkey),
        eq(messages.id, conversations.lastMessageId),
      ),
    )
    .where(eq(savedGroups.accountPubkey, accountPubkey))
    .orderBy(
      desc(conversations.pinned),
      desc(conversations.updatedOrderAt),
      desc(conversations.conversationKey),
    );
}

export function useSavedGroups(
  accountPubkey: string,
): { groups: ConversationWithLast[]; loaded: boolean } {
  const { data, isResolved } = useLiveQuery(selectSavedGroups(accountPubkey), [
    accountPubkey,
    'saved-groups',
  ]);
  const groups = useMemo(() => {
    const saved = data ?? [];
    for (const item of saved) rememberConversationSnapshot(item.conversation);
    return saved;
  }, [data]);
  return { groups, loaded: isResolved };
}

export function useIsGroupSaved(
  accountPubkey: string,
  groupId: string | null | undefined,
): { saved: boolean; loaded: boolean } {
  const { data, isResolved } = useLiveQuery(
    db
      .select({ groupId: savedGroups.groupId })
      .from(savedGroups)
      .where(
        and(
          eq(savedGroups.accountPubkey, accountPubkey),
          eq(savedGroups.groupId, groupId ?? ''),
        ),
      )
      .limit(1),
    [accountPubkey, groupId],
  );
  return { saved: (data?.length ?? 0) > 0, loaded: isResolved };
}

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
