import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations, messageDrafts, pendingAttachments } from '@/db/schema';
import {
  generateGroupId,
  groupConversationKey,
  initialGroupMembers,
  isValidMemberPubkey,
} from '@/lib/nostr/group-messaging';
import { deletePendingAttachmentFile } from '@/services/files/pending-attachment-file.service';

export type LocalGroup = {
  conversationKey: string;
  groupId: string;
};

function normalizeLocalName(name: string | null | undefined): string | null {
  const normalized = name?.trim() ?? '';
  if ([...normalized].length > 80) throw new Error('Group name is too long');
  return normalized || null;
}

class GroupService {
  async createLocalGroup(
    accountPubkey: string,
    selectedPubkeys: readonly string[],
    name?: string | null,
  ): Promise<LocalGroup> {
    const memberPubkeys = initialGroupMembers(accountPubkey, selectedPubkeys);
    const groupId = generateGroupId();
    const conversationKey = groupConversationKey(groupId);
    const nowOrderAt = Date.now();
    await db.insert(conversations).values({
      accountPubkey,
      conversationKey,
      groupId,
      memberPubkeys,
      name: normalizeLocalName(name),
      createdAt: Math.floor(nowOrderAt / 1000),
      createdOrderAt: nowOrderAt,
      updatedAt: Math.floor(nowOrderAt / 1000),
      updatedOrderAt: nowOrderAt,
      lastMessageAt: null,
      lastMessageOrderAt: null,
      lastMessageId: null,
      unreadCount: 0,
      hasReplied: true,
      deleted: false,
    });
    return { conversationKey, groupId };
  }

  async updateLocalRoster(
    accountPubkey: string,
    conversationKey: string,
    memberPubkeys: readonly string[],
  ): Promise<void> {
    const members = [...new Set(memberPubkeys)];
    if (members.some((pubkey) => !isValidMemberPubkey(pubkey))) {
      throw new Error('Invalid group member pubkey');
    }
    await this.updateLocalOnly(accountPubkey, conversationKey, { memberPubkeys: members.sort() });
  }

  async renameLocalGroup(
    accountPubkey: string,
    conversationKey: string,
    name: string | null,
  ): Promise<void> {
    await this.updateLocalOnly(accountPubkey, conversationKey, {
      name: normalizeLocalName(name),
    });
  }

  async abandonLocalGroup(accountPubkey: string, conversationKey: string): Promise<void> {
    const pending = await db
      .select({ localName: pendingAttachments.localName })
      .from(pendingAttachments)
      .where(
        and(
          eq(pendingAttachments.accountPubkey, accountPubkey),
          eq(pendingAttachments.conversationKey, conversationKey),
        ),
      );
    await db.transaction(async (tx) => {
      const [localGroup] = await tx
        .select({ eventId: conversations.membersBootstrapEventId })
        .from(conversations)
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, conversationKey),
            sql`${conversations.groupId} IS NOT NULL`,
          ),
        )
        .limit(1);
      if (!localGroup || localGroup.eventId) throw new Error('Group is not a local draft');
      await tx
        .delete(pendingAttachments)
        .where(
          and(
            eq(pendingAttachments.accountPubkey, accountPubkey),
            eq(pendingAttachments.conversationKey, conversationKey),
          ),
        );
      await tx
        .delete(messageDrafts)
        .where(
          and(
            eq(messageDrafts.accountPubkey, accountPubkey),
            eq(messageDrafts.conversationKey, conversationKey),
          ),
        );
      await tx
        .delete(conversations)
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, conversationKey),
          ),
        );
    });
    await Promise.all(pending.map((row) => deletePendingAttachmentFile(row.localName)));
  }

  private async updateLocalOnly(
    accountPubkey: string,
    conversationKey: string,
    patch: { memberPubkeys?: string[]; name?: string | null },
  ): Promise<void> {
    const [localGroup] = await db
      .select({ conversationKey: conversations.conversationKey })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
          sql`${conversations.groupId} IS NOT NULL`,
          sql`${conversations.membersBootstrapEventId} IS NULL`,
        ),
      )
      .limit(1);
    if (!localGroup) throw new Error('Group is not a local draft');
    await db
      .update(conversations)
      .set(patch)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
          sql`${conversations.groupId} IS NOT NULL`,
          sql`${conversations.membersBootstrapEventId} IS NULL`,
        ),
      );
  }
}

export const groupService = new GroupService();
