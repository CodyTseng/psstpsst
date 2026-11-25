import { and, eq, inArray } from 'drizzle-orm';

import type { db } from '@/db/client';
import { messageDeletions, type Rumor } from '@/db/schema';
import { reactionRetractionTarget } from '@/lib/nostr/reaction-retraction';
import { parseGroupAction } from '@/lib/nostr/group-messaging';
import { KIND_CHAT, KIND_FILE, KIND_MESSAGE_DELETION, KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function isDeletableMessage(kind: number, tags: string[][], isGroup: boolean): boolean {
  return (kind === KIND_CHAT || kind === KIND_FILE) &&
    (!isGroup || parseGroupAction(tags).status !== 'valid');
}

export function canApplyMessageDeletion(
  accountPubkey: string,
  target: { id: string; kind: number; tags: string[][]; senderPubkey: string },
  request: Rumor,
  isGroup: boolean,
): boolean {
  if (target.kind === KIND_REACTION) {
    return request.pubkey === target.senderPubkey && reactionRetractionTarget(request) === target.id;
  }
  return !request.tags.some(([key, kind]) => key === 'k' && kind === String(KIND_REACTION)) &&
    isDeletableMessage(target.kind, target.tags, isGroup) &&
    (request.pubkey === accountPubkey || request.pubkey === target.senderPubkey);
}

export function isSelfAddressedMessageDeletion(rumor: Rumor, accountPubkey: string): boolean {
  if (rumor.kind !== KIND_MESSAGE_DELETION || rumor.pubkey !== accountPubkey) return false;
  const recipients = rumor.tags.filter(([key]) => key === 'p');
  return recipients.length === 1 && recipients[0][1] === accountPubkey;
}

/** Resolve authenticated requests when their target is accepted for storage. */
export async function resolvePendingMessageDeletions(
  tx: Tx,
  accountPubkey: string,
  rumor: Rumor,
  isGroup: boolean,
): Promise<{ selfAddressed: boolean } | null> {
  const scope = and(
    eq(messageDeletions.accountPubkey, accountPubkey),
    eq(messageDeletions.pendingTargetId, rumor.id),
  );
  const pending = await tx.select({ id: messageDeletions.id, rumor: messageDeletions.rumor })
    .from(messageDeletions).where(scope);
  const target = { ...rumor, senderPubkey: rumor.pubkey };
  const valid = pending.filter(row => canApplyMessageDeletion(accountPubkey, target, row.rumor, isGroup));
  const validIds = new Set(valid.map(row => row.id));
  const invalid = pending.filter(row => !validIds.has(row.id));
  for (let i = 0; i < invalid.length; i += 250) {
    await tx.delete(messageDeletions).where(and(scope,
      inArray(messageDeletions.id, invalid.slice(i, i + 250).map(row => row.id))));
  }
  for (let i = 0; i < valid.length; i += 250) {
    await tx.update(messageDeletions).set({ pendingTargetId: null }).where(and(scope,
      inArray(messageDeletions.id, valid.slice(i, i + 250).map(row => row.id))));
  }
  return valid.length > 0 ? {
    selfAddressed: valid.some(row => isSelfAddressedMessageDeletion(row.rumor, accountPubkey)),
  } : null;
}
