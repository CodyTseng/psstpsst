import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations, savedGroups } from '@/db/schema';
import { isValidGroupId } from '@/lib/nostr/group-messaging';

import {
  markContactsDirty,
  queueContactSetPublication,
} from '../contact/contact.service';
import type { Signer } from '../signer/signer.interface';

export async function setGroupSaved(
  accountPubkey: string,
  groupId: string,
  saved: boolean,
  options: { signer?: Signer } = {},
): Promise<void> {
  if (!isValidGroupId(groupId)) throw new Error('Invalid group id');
  await db.transaction(async (tx) => {
    await markContactsDirty(accountPubkey, tx);
    if (saved) {
      await tx
        .insert(savedGroups)
        .values({ accountPubkey, groupId })
        .onConflictDoNothing()
        .run();
      await tx
        .update(conversations)
        .set({
          deleted: false,
          deletedAt: null,
          deletedOrderAt: null,
          hasReplied: true,
        })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.groupId, groupId),
          ),
        )
        .run();
    } else {
      await tx
        .delete(savedGroups)
        .where(and(
          eq(savedGroups.accountPubkey, accountPubkey),
          eq(savedGroups.groupId, groupId),
        ));
    }
  });
  queueContactSetPublication(accountPubkey, options.signer);
}
