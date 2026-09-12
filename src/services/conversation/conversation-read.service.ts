import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations } from '@/db/schema';

/**
 * Mark every unread message request as read in one set-based update.
 *
 * Each conversation already stores the newest real-message cursor, so copying
 * that cursor avoids one message lookup per request and keeps the work bounded
 * to the rows that actually change. A message stored after this statement runs
 * advances the conversation normally and becomes unread again.
 */
export async function markAllRequestConversationsAsRead(
  accountPubkey: string,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      unreadCount: 0,
      lastReadAt: sql`${conversations.lastMessageAt}`,
      lastReadOrderAt: sql`${conversations.lastMessageOrderAt}`,
      lastReadMessageId: sql`${conversations.lastMessageId}`,
    })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.deleted, false),
        eq(conversations.hasReplied, false),
        gt(conversations.unreadCount, 0),
      ),
    );
}
