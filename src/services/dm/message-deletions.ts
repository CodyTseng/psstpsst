import { and, eq, sql } from 'drizzle-orm';

import type { db } from '@/db/client';
import { messageDeletions, type Rumor } from '@/db/schema';
import { parseGroupAction } from '@/lib/nostr/group-messaging';
import { KIND_CHAT, KIND_FILE } from '@/services/crypto/nip17-gift-wrap';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function isDeletableMessage(kind: number, tags: string[][], isGroup: boolean): boolean {
  return (kind === KIND_CHAT || kind === KIND_FILE) &&
    (!isGroup || parseGroupAction(tags).status !== 'valid');
}

export function deletionAuthorMatches(accountPubkey: string, messageAuthor: string, requestAuthor: string): boolean {
  return requestAuthor === accountPubkey || requestAuthor === messageAuthor;
}

/** Resolve authenticated requests when their target is accepted for storage. */
export async function resolvePendingMessageDeletions(
  tx: Tx,
  accountPubkey: string,
  rumor: Rumor,
  isGroup: boolean,
): Promise<boolean> {
  const scope = and(
    eq(messageDeletions.accountPubkey, accountPubkey),
    eq(messageDeletions.pendingTargetId, rumor.id),
  );
  const pending = await tx.select({ id: messageDeletions.id }).from(messageDeletions)
    .where(scope).limit(1).get();
  if (!pending) return false;
  if (!isDeletableMessage(rumor.kind, rumor.tags, isGroup)) {
    await tx.delete(messageDeletions).where(scope);
    return false;
  }
  const requestAuthor = sql`json_extract(${messageDeletions.rumor}, '$.pubkey')`;
  await tx.delete(messageDeletions).where(and(
    scope,
    sql`${requestAuthor} NOT IN (${accountPubkey}, ${rumor.pubkey})`,
  ));
  const applied = await tx.update(messageDeletions).set({ pendingTargetId: null }).where(scope)
    .returning({ id: messageDeletions.id });
  return applied.length > 0;
}
