import { and, eq, gt, isNull, or } from 'drizzle-orm';

import type { Database } from '@/db/client';
import { conversations, messages, type Rumor } from '@/db/schema';
import { getReplyToId } from '@/lib/nostr/tags';
import { isDeletableMessage } from '@/services/dm/message-deletions';

export async function reactionTargetsOwnVisibleMessage(
  tx: Database,
  conversation: typeof conversations.$inferSelect,
  reaction: Rumor,
): Promise<boolean> {
  const { accountPubkey, conversationKey, deliveryKind, groupId, proximityAccountPubkey } = conversation;
  const ownPubkey = deliveryKind === 'proximity' ? proximityAccountPubkey : accountPubkey;
  const targetId = getReplyToId(reaction.tags);
  if (!ownPubkey || reaction.pubkey === ownPubkey || !targetId) return false;

  const target = await tx.select({ kind: messages.kind, tags: messages.tags }).from(messages)
    .where(and(
      eq(messages.accountPubkey, accountPubkey),
      eq(messages.conversationKey, conversationKey),
      eq(messages.id, targetId),
      eq(messages.senderPubkey, ownPubkey),
      eq(messages.deleted, false),
      or(isNull(messages.expiresAt), gt(messages.expiresAt, Date.now())),
    )).get();
  return !!target && isDeletableMessage(target.kind, target.tags, groupId !== null);
}
