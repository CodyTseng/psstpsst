import { and, asc, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  contacts,
  conversations,
  groupMemberActions,
  messages,
  pendingGroupRumors,
  relayOutboxJobs,
  type Rumor,
} from '@/db/schema';
import {
  bootstrapMembers,
  firstGroupId,
  groupConversationKey,
  isFinalizedNetworkEvent,
  parseGroupAction,
  parseGroupSubject,
  validMemberPubkeys,
  type GroupAction,
} from '@/lib/nostr/group-messaging';
import { isMessageOrderNewer, messageOrderAt } from '@/lib/nostr/message-order';
import { getReplyToId } from '@/lib/nostr/tags';
import { findFileMeta } from '@/lib/nostr/file-tags';
import {
  KIND_CHAT,
  KIND_FILE,
  KIND_REACTION,
} from '@/services/crypto/nip17-gift-wrap';
import {
  recordAttachmentMedia,
  recordEmbeddedMedia,
} from '@/services/files/media-index.service';
import { getSyncCursor, type SyncCursor } from '@/services/dm/sync-store';
import { mergeStoredMessageIntoTail } from '@/services/conversation/message-tail-cache';

import {
  replayMembershipActions,
  type MembershipActionRecord,
} from './group-membership';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type GroupRumorIntake = 'live' | 'recovery' | 'history' | 'archive' | 'local';

export type ReceiveGroupRumorOptions = {
  accountPubkey: string;
  rumor: Rumor;
  sourceRelays?: string[];
  intake: GroupRumorIntake;
  active: boolean;
  senderBlocked: boolean;
  /** Coverage snapshot captured when the envelope was first seen. */
  syncCursor?: SyncCursor | null;
};

export type ReceiveGroupRumorResult = {
  handled: boolean;
  stored: boolean;
  conversationKey: string | null;
  promoted: Rumor[];
};

const UNREAD_CAP = 100;
const GROUP_PENDING_CAP = 256;
const ACCOUNT_PENDING_CAP = 2_048;

function actionIsMembership(
  action: GroupAction,
): action is Extract<GroupAction, { type: 'invite' | 'remove' }> {
  return action.type === 'invite' || action.type === 'remove';
}

function actionIsStructurallyValid(rumor: Rumor, action: GroupAction, pTags: string[]): boolean {
  if (action.type === 'create') {
    return (
      (rumor.kind === KIND_CHAT && rumor.content.trim().length > 0) ||
      (rumor.kind === KIND_FILE && findFileMeta(rumor.content, rumor.tags) != null)
    );
  }
  if (rumor.kind !== KIND_CHAT || rumor.content !== '') return false;
  if (action.type === 'invite') return pTags.includes(action.memberPubkey);
  if (action.type === 'remove') {
    return action.memberPubkey === rumor.pubkey || pTags.includes(action.memberPubkey);
  }
  return true;
}

function parseMembers(value: string[] | null): string[] {
  return Array.isArray(value) ? value : [];
}

function unreadAfterCursor(orderAt: number, eventId: string) {
  return or(
    sql`${messages.orderAt} > ${orderAt}`,
    and(eq(messages.orderAt, orderAt), lt(messages.id, eventId)),
  );
}

async function countUnread(
  tx: Tx,
  accountPubkey: string,
  conversationKey: string,
  cursor: { orderAt: number; id: string } | null,
): Promise<number> {
  const rows = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.accountPubkey, accountPubkey),
        eq(messages.conversationKey, conversationKey),
        inArray(messages.kind, [KIND_CHAT, KIND_FILE]),
        cursor ? unreadAfterCursor(cursor.orderAt, cursor.id) : undefined,
      ),
    )
    .orderBy(asc(messages.orderAt), desc(messages.id))
    .limit(UNREAD_CAP);
  return rows.length;
}

async function insertGroupMessage(
  tx: Tx,
  accountPubkey: string,
  conversationKey: string,
  rumor: Rumor,
  sourceRelays?: string[],
  enqueueRelay = false,
): Promise<boolean> {
  const subject = parseGroupSubject(rumor.tags);
  const inserted = await tx
    .insert(messages)
    .values({
      accountPubkey,
      id: rumor.id!,
      conversationKey,
      senderPubkey: rumor.pubkey,
      kind: rumor.kind,
      content: rumor.content,
      createdAt: rumor.created_at,
      orderAt: messageOrderAt(rumor),
      replyToId: getReplyToId(rumor.tags) ?? null,
      subject: subject.status === 'valid' ? subject.name : null,
      tags: rumor.tags,
      rumor,
      deliveryStatus:
        enqueueRelay && (rumor.kind === KIND_CHAT || rumor.kind === KIND_FILE)
          ? 'queued'
          : null,
      sourceRelays: sourceRelays?.length ? [...new Set(sourceRelays)].sort() : null,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id })
    .all();
  if (inserted.length === 0) return false;
  if (enqueueRelay) {
    await tx.insert(relayOutboxJobs).values({
      accountPubkey,
      messageId: rumor.id!,
      scope: 'all_recipient_relays',
      createdAt: Math.floor(Date.now() / 1000),
    });
  }
  if (rumor.kind === KIND_FILE) {
    await recordAttachmentMedia(tx, rumor, accountPubkey, conversationKey);
  } else if (rumor.kind === KIND_CHAT && rumor.content !== '') {
    await recordEmbeddedMedia(tx, rumor, accountPubkey, conversationKey);
  }
  return true;
}

async function quarantine(
  tx: Tx,
  options: ReceiveGroupRumorOptions,
  conversationKey: string,
  reason:
    | 'pre_bootstrap'
    | 'pre_bootstrap_archive'
    | 'membership_candidate'
    | 'membership_candidate_archive',
): Promise<void> {
  const { accountPubkey, rumor, sourceRelays } = options;
  await tx
    .insert(pendingGroupRumors)
    .values({
      accountPubkey,
      conversationKey,
      messageId: rumor.id!,
      orderAt: messageOrderAt(rumor),
      senderPubkey: rumor.pubkey,
      rumor,
      sourceRelays: sourceRelays?.length ? [...new Set(sourceRelays)].sort() : null,
      pendingReason: reason,
      receivedAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();

  const groupRows = await tx
    .select({ messageId: pendingGroupRumors.messageId })
    .from(pendingGroupRumors)
    .where(
      and(
        eq(pendingGroupRumors.accountPubkey, accountPubkey),
        eq(pendingGroupRumors.conversationKey, conversationKey),
      ),
    )
    .orderBy(
      asc(sql`CASE WHEN ${pendingGroupRumors.pendingReason} IN ('pre_bootstrap', 'pre_bootstrap_archive') THEN 1 ELSE 0 END`),
      desc(pendingGroupRumors.orderAt),
      asc(pendingGroupRumors.messageId),
    );
  const groupOverflow = groupRows.slice(GROUP_PENDING_CAP);
  if (groupOverflow.length) {
    await tx.delete(pendingGroupRumors).where(
      and(
        eq(pendingGroupRumors.accountPubkey, accountPubkey),
        inArray(pendingGroupRumors.messageId, groupOverflow.map((row) => row.messageId)),
      ),
    );
  }

  const accountRows = await tx
    .select({ messageId: pendingGroupRumors.messageId })
    .from(pendingGroupRumors)
    .where(eq(pendingGroupRumors.accountPubkey, accountPubkey))
    .orderBy(
      asc(sql`CASE WHEN ${pendingGroupRumors.pendingReason} IN ('pre_bootstrap', 'pre_bootstrap_archive') THEN 1 ELSE 0 END`),
      desc(pendingGroupRumors.orderAt),
      asc(pendingGroupRumors.messageId),
    );
  const accountOverflow = accountRows.slice(ACCOUNT_PENDING_CAP);
  if (accountOverflow.length) {
    await tx.delete(pendingGroupRumors).where(
      and(
        eq(pendingGroupRumors.accountPubkey, accountPubkey),
        inArray(pendingGroupRumors.messageId, accountOverflow.map((row) => row.messageId)),
      ),
    );
  }
}

function newestCursor(
  current: { orderAt: number; id: string } | null,
  candidate: { orderAt: number; id: string },
): { orderAt: number; id: string } {
  return !current || isMessageOrderNewer(candidate, current) ? candidate : current;
}

async function refreshConversationMessageState(
  tx: Tx,
  options: ReceiveGroupRumorOptions,
  conversationKey: string,
  advanceActivity: boolean,
): Promise<void> {
  const { accountPubkey, rumor, active } = options;
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    )
    .limit(1);
  if (!conversation) return;
  const eventOrderAt = messageOrderAt(rumor);
  const canResurrect =
    !conversation.deleted ||
    conversation.deletedOrderAt == null ||
    eventOrderAt > conversation.deletedOrderAt;
  if (!canResurrect) return;

  const newest = await tx
    .select({ id: messages.id, createdAt: messages.createdAt, orderAt: messages.orderAt })
    .from(messages)
    .where(
      and(
        eq(messages.accountPubkey, accountPubkey),
        eq(messages.conversationKey, conversationKey),
        inArray(messages.kind, [KIND_CHAT, KIND_FILE]),
      ),
    )
    .orderBy(desc(messages.orderAt), asc(messages.id))
    .limit(1);

  const ownOrActive = rumor.pubkey === accountPubkey || active;
  const eventCursor = { orderAt: messageOrderAt(rumor), id: rumor.id! };
  const previousCursor =
    conversation.lastReadOrderAt == null
      ? null
      : { orderAt: conversation.lastReadOrderAt, id: conversation.lastReadMessageId ?? '' };
  const readCursor = ownOrActive ? newestCursor(previousCursor, eventCursor) : previousCursor;
  const unread = await countUnread(tx, accountPubkey, conversationKey, readCursor);
  const activityOrderAt = Date.now();
  const activityAt = Math.floor(activityOrderAt / 1000);
  const acceptedByLocalActivity = options.intake === 'local';

  await tx
    .update(conversations)
    .set({
      lastMessageId: newest[0]?.id ?? null,
      lastMessageAt: newest[0]?.createdAt ?? null,
      lastMessageOrderAt: newest[0]?.orderAt ?? null,
      unreadCount: unread,
      deleted: false,
      hasReplied: acceptedByLocalActivity
        ? true
        : conversation.deleted
          ? false
          : conversation.hasReplied,
      ...(readCursor
        ? {
            lastReadOrderAt: readCursor.orderAt,
            lastReadMessageId: readCursor.id || null,
            lastReadAt:
              readCursor.orderAt === eventCursor.orderAt
                ? rumor.created_at
                : conversation.lastReadAt,
          }
        : {}),
      ...(advanceActivity
        ? {
            updatedAt: sql`CASE WHEN ${conversations.updatedOrderAt} < ${activityOrderAt} THEN ${activityAt} ELSE ${conversations.updatedAt} END`,
            updatedOrderAt: sql`MAX(${conversations.updatedOrderAt}, ${activityOrderAt})`,
          }
        : {}),
    })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    );
}

async function updateNameState(
  tx: Tx,
  accountPubkey: string,
  conversationKey: string,
  rumor: Rumor,
  finalized: boolean,
): Promise<void> {
  if (rumor.kind === KIND_REACTION || finalized) return;
  const subject = parseGroupSubject(rumor.tags);
  if (subject.status !== 'valid') return;
  const [conversation] = await tx
    .select({ orderAt: conversations.nameOrderAt, eventId: conversations.nameEventId })
    .from(conversations)
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    )
    .limit(1);
  const candidate = { orderAt: messageOrderAt(rumor), id: rumor.id! };
  const current =
    conversation?.orderAt == null || !conversation.eventId
      ? null
      : { orderAt: conversation.orderAt, id: conversation.eventId };
  if (current && !isMessageOrderNewer(candidate, current)) return;
  await tx
    .update(conversations)
    .set({ name: subject.name, nameOrderAt: candidate.orderAt, nameEventId: candidate.id })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    );
}

async function replayKnownMembership(
  tx: Tx,
  options: ReceiveGroupRumorOptions,
  conversationKey: string,
  conversation: typeof conversations.$inferSelect,
): Promise<{ stored: boolean; promoted: Rumor[] }> {
  const { accountPubkey, rumor, sourceRelays } = options;
  const parsed = parseGroupAction(rumor.tags);
  if (parsed.status !== 'valid' || !actionIsMembership(parsed.action)) {
    return { stored: false, promoted: [] };
  }
  const knownMessage = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, rumor.id!)))
    .limit(1);
  const knownAction = await tx
    .select({ id: groupMemberActions.eventId })
    .from(groupMemberActions)
    .where(
      and(
        eq(groupMemberActions.accountPubkey, accountPubkey),
        eq(groupMemberActions.eventId, rumor.id!),
      ),
    )
    .limit(1);
  const knownPending = await tx
    .select({ id: pendingGroupRumors.messageId })
    .from(pendingGroupRumors)
    .where(
      and(
        eq(pendingGroupRumors.accountPubkey, accountPubkey),
        eq(pendingGroupRumors.messageId, rumor.id!),
      ),
    )
    .limit(1);
  if (knownMessage.length || knownAction.length || knownPending.length) {
    return { stored: false, promoted: [] };
  }

  if (!conversation.membersBootstrapEventId || conversation.membersBootstrapOrderAt == null) {
    await quarantine(
      tx,
      options,
      conversationKey,
      options.intake === 'archive'
        ? 'membership_candidate_archive'
        : 'membership_candidate',
    );
    return { stored: false, promoted: [] };
  }
  const candidateCursor = { orderAt: messageOrderAt(rumor), id: rumor.id! };
  const tailCursor =
    conversation.membersActionOrderAt == null || !conversation.membersActionEventId
      ? {
          orderAt: conversation.membersBootstrapOrderAt,
          id: conversation.membersBootstrapEventId,
        }
      : {
          orderAt: conversation.membersActionOrderAt,
          id: conversation.membersActionEventId,
        };
  if (isMessageOrderNewer(candidateCursor, tailCursor)) {
    const members = new Set(parseMembers(conversation.memberPubkeys));
    const authorized = members.has(rumor.pubkey);
    let stored = false;
    if (authorized) {
      if (parsed.action.type === 'invite') members.add(parsed.action.memberPubkey);
      else members.delete(parsed.action.memberPubkey);
      await tx.insert(groupMemberActions).values({
        accountPubkey,
        conversationKey,
        eventId: rumor.id!,
        authorPubkey: rumor.pubkey,
        memberPubkey: parsed.action.memberPubkey,
        action: parsed.action.type,
        orderAt: candidateCursor.orderAt,
        rumor,
        applied: true,
      });
      stored = await insertGroupMessage(
        tx,
        accountPubkey,
        conversationKey,
        rumor,
        sourceRelays,
        options.intake === 'local',
      );
      if (stored) {
        await updateNameState(tx, accountPubkey, conversationKey, rumor, false);
      }
    } else {
      await quarantine(
        tx,
        options,
        conversationKey,
        options.intake === 'archive'
          ? 'membership_candidate_archive'
          : 'membership_candidate',
      );
    }
    await tx
      .update(conversations)
      .set({
        memberPubkeys: [...members].sort(),
        membersActionOrderAt: candidateCursor.orderAt,
        membersActionEventId: candidateCursor.id,
      })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      );
    if (stored) await refreshConversationMessageState(tx, options, conversationKey, true);
    return { stored, promoted: stored ? [rumor] : [] };
  }

  await quarantine(
    tx,
    options,
    conversationKey,
    options.intake === 'archive'
      ? 'membership_candidate_archive'
      : 'membership_candidate',
  );
  const [bootstrap] = await tx
    .select({ rumor: messages.rumor })
    .from(messages)
    .where(
      and(
        eq(messages.accountPubkey, accountPubkey),
        eq(messages.id, conversation.membersBootstrapEventId),
      ),
    )
    .limit(1);
  if (!bootstrap) return { stored: false, promoted: [] };

  const [formal, pending] = await Promise.all([
    tx
      .select()
      .from(groupMemberActions)
      .where(
        and(
          eq(groupMemberActions.accountPubkey, accountPubkey),
          eq(groupMemberActions.conversationKey, conversationKey),
        ),
      ),
    tx
      .select()
      .from(pendingGroupRumors)
      .where(
        and(
          eq(pendingGroupRumors.accountPubkey, accountPubkey),
          eq(pendingGroupRumors.conversationKey, conversationKey),
          inArray(pendingGroupRumors.pendingReason, [
            'membership_candidate',
            'membership_candidate_archive',
          ]),
        ),
      ),
  ]);
  const pendingById = new Map(pending.map((row) => [row.messageId, row]));
  const records: MembershipActionRecord[] = [
    ...formal.map((row) => ({
      id: row.eventId,
      orderAt: row.orderAt,
      authorPubkey: row.authorPubkey,
      memberPubkey: row.memberPubkey,
      action: row.action,
      everApplied: true,
    })),
    ...pending.flatMap((row): MembershipActionRecord[] => {
      const action = parseGroupAction(row.rumor.tags);
      return action.status === 'valid' && actionIsMembership(action.action)
        ? [{
            id: row.messageId,
            orderAt: row.orderAt,
            authorPubkey: row.senderPubkey,
            memberPubkey: action.action.memberPubkey,
            action: action.action.type,
            everApplied: false,
          }]
        : [];
    }),
  ];
  const replay = replayMembershipActions(
    bootstrapMembers(bootstrap.rumor.pubkey, bootstrap.rumor.tags),
    {
      orderAt: conversation.membersBootstrapOrderAt,
      id: conversation.membersBootstrapEventId,
    },
    records,
  );

  for (const action of replay.actions) {
    if (action.everApplied) {
      await tx
        .update(groupMemberActions)
        .set({ applied: action.applied })
        .where(
          and(
            eq(groupMemberActions.accountPubkey, accountPubkey),
            eq(groupMemberActions.eventId, action.id),
          ),
        );
    }
  }

  const promoted: Rumor[] = [];
  for (const action of replay.actions) {
    if (!action.firstApplication) continue;
    const pendingRow = pendingById.get(action.id);
    if (!pendingRow) continue;
    await tx.insert(groupMemberActions).values({
      accountPubkey,
      conversationKey,
      eventId: action.id,
      authorPubkey: action.authorPubkey,
      memberPubkey: action.memberPubkey,
      action: action.action,
      orderAt: action.orderAt,
      rumor: pendingRow.rumor,
      applied: true,
    });
    await tx
      .delete(pendingGroupRumors)
      .where(
        and(
          eq(pendingGroupRumors.accountPubkey, accountPubkey),
          eq(pendingGroupRumors.messageId, action.id),
        ),
      );
    if (
      await insertGroupMessage(
        tx,
        accountPubkey,
        conversationKey,
        pendingRow.rumor,
        pendingRow.sourceRelays ?? undefined,
        options.intake === 'local' && pendingRow.messageId === rumor.id,
      )
    ) {
      promoted.push(pendingRow.rumor);
      await updateNameState(
        tx,
        accountPubkey,
        conversationKey,
        pendingRow.rumor,
        false,
      );
    }
  }

  await tx
    .update(conversations)
    .set({
      memberPubkeys: replay.members,
      membersActionOrderAt: replay.tail?.orderAt ?? null,
      membersActionEventId: replay.tail?.id ?? null,
    })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    );

  const stored = promoted.some((item) => item.id === rumor.id);
  if (promoted.length) {
    await refreshConversationMessageState(tx, options, conversationKey, false);
  }
  return { stored, promoted };
}

async function releasePrebootstrapRumors(
  tx: Tx,
  options: ReceiveGroupRumorOptions,
  conversationKey: string,
  bootstrapRumor: Rumor,
  finalityCursor: SyncCursor | null,
): Promise<Rumor[]> {
  const { accountPubkey } = options;
  const pending = await tx
    .select()
    .from(pendingGroupRumors)
    .where(
      and(
        eq(pendingGroupRumors.accountPubkey, accountPubkey),
        eq(pendingGroupRumors.conversationKey, conversationKey),
      ),
    )
    .orderBy(asc(pendingGroupRumors.orderAt), desc(pendingGroupRumors.messageId));
  if (!pending.length) return [];

  const baseline = bootstrapMembers(bootstrapRumor.pubkey, bootstrapRumor.tags);
  const baselineSet = new Set(baseline);
  const actionCandidates = pending.flatMap((row): MembershipActionRecord[] => {
    const parsed = parseGroupAction(row.rumor.tags);
    return parsed.status === 'valid' && actionIsMembership(parsed.action)
      ? [{
          id: row.messageId,
          orderAt: row.orderAt,
          authorPubkey: row.senderPubkey,
          memberPubkey: parsed.action.memberPubkey,
          action: parsed.action.type,
          everApplied: false,
        }]
      : [];
  });
  const replay = replayMembershipActions(
    baseline,
    { orderAt: messageOrderAt(bootstrapRumor), id: bootstrapRumor.id! },
    actionCandidates,
  );
  const appliedIds = new Set(
    replay.actions.filter((action) => action.applied).map((action) => action.id),
  );
  const promoted: Rumor[] = [];

  for (const row of pending) {
    const parsed = parseGroupAction(row.rumor.tags);
    if (parsed.status === 'valid' && actionIsMembership(parsed.action)) {
      if (!appliedIds.has(row.messageId)) continue;
      await tx.insert(groupMemberActions).values({
        accountPubkey,
        conversationKey,
        eventId: row.messageId,
        authorPubkey: row.senderPubkey,
        memberPubkey: parsed.action.memberPubkey,
        action: parsed.action.type,
        orderAt: row.orderAt,
        rumor: row.rumor,
        applied: true,
      });
    } else {
      const acceptable =
        baselineSet.has(row.senderPubkey) &&
        (parsed.status === 'none' ||
          (parsed.status === 'valid' && parsed.action.type === 'rename'));
      if (!acceptable) {
        await tx
          .delete(pendingGroupRumors)
          .where(
            and(
              eq(pendingGroupRumors.accountPubkey, accountPubkey),
              eq(pendingGroupRumors.messageId, row.messageId),
            ),
          );
        continue;
      }
    }

    await tx
      .delete(pendingGroupRumors)
      .where(
        and(
          eq(pendingGroupRumors.accountPubkey, accountPubkey),
          eq(pendingGroupRumors.messageId, row.messageId),
        ),
      );
    if (
      await insertGroupMessage(
        tx,
        accountPubkey,
        conversationKey,
        row.rumor,
        row.sourceRelays ?? undefined,
      )
    ) {
      promoted.push(row.rumor);
      const finalized =
        row.pendingReason !== 'pre_bootstrap_archive' &&
        row.pendingReason !== 'membership_candidate_archive' &&
        finalityCursor != null &&
        isFinalizedNetworkEvent(
          { orderAt: row.orderAt },
          finalityCursor.forwardSince,
          finalityCursor.backwardUntil,
        );
      await updateNameState(tx, accountPubkey, conversationKey, row.rumor, finalized);
    }
  }

  const tail = replay.tail;
  await tx
    .update(conversations)
    .set({
      memberPubkeys: replay.members,
      membersActionOrderAt: tail?.orderAt ?? null,
      membersActionEventId: tail?.id ?? null,
    })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    );
  return promoted;
}

class GroupReceiveService {
  async finalizeCoveredHistory(accountPubkey: string, forwardSince: number): Promise<void> {
    if (typeof (db as unknown as { delete?: unknown }).delete !== 'function') return;
    await db
      .delete(pendingGroupRumors)
      .where(
        and(
          eq(pendingGroupRumors.accountPubkey, accountPubkey),
          lt(pendingGroupRumors.orderAt, forwardSince * 1000),
          notInArray(pendingGroupRumors.pendingReason, [
            'pre_bootstrap_archive',
            'membership_candidate_archive',
          ]),
        ),
      );
  }

  async receive(options: ReceiveGroupRumorOptions): Promise<ReceiveGroupRumorResult> {
    const { accountPubkey, rumor, intake, senderBlocked } = options;
    const groupId = firstGroupId(rumor.tags);
    if (!groupId) return { handled: false, stored: false, conversationKey: null, promoted: [] };
    const conversationKey = groupConversationKey(groupId);
    if (![KIND_CHAT, KIND_FILE, KIND_REACTION].includes(rumor.kind)) {
      return { handled: true, stored: false, conversationKey, promoted: [] };
    }
    const action = parseGroupAction(rumor.tags);
    if (action.status === 'invalid') {
      return { handled: true, stored: false, conversationKey, promoted: [] };
    }
    const pTags = validMemberPubkeys(rumor.tags);
    if (rumor.pubkey !== accountPubkey && !pTags.includes(accountPubkey)) {
      return { handled: true, stored: false, conversationKey, promoted: [] };
    }
    if (
      action.status === 'valid' &&
      !actionIsStructurallyValid(rumor, action.action, pTags)
    ) {
      return { handled: true, stored: false, conversationKey, promoted: [] };
    }

    const cursor = intake === 'archive' || intake === 'local'
      ? null
      : options.syncCursor === undefined
        ? await getSyncCursor(accountPubkey)
        : options.syncCursor;
    const finalized = cursor
      ? isFinalizedNetworkEvent(
          { orderAt: messageOrderAt(rumor) },
          cursor.forwardSince,
          cursor.backwardUntil,
        )
      : false;
    if (finalized && action.status === 'valid') {
      return { handled: true, stored: false, conversationKey, promoted: [] };
    }

    const transactionResult = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, conversationKey),
          ),
        )
        .limit(1);
      if (conversation?.groupId && conversation.groupId !== groupId) {
        return { handled: true, stored: false, conversationKey, promoted: [] };
      }

      if (!conversation) {
        const bootstrap =
          action.status === 'valid' &&
          (action.action.type === 'create' || action.action.type === 'invite');
        if (!bootstrap || senderBlocked) {
          if (!senderBlocked) {
            await quarantine(
              tx,
              options,
              conversationKey,
              action.status === 'valid'
                ? intake === 'archive'
                  ? 'membership_candidate_archive'
                  : 'membership_candidate'
                : intake === 'archive'
                  ? 'pre_bootstrap_archive'
                  : 'pre_bootstrap',
            );
          }
          return { handled: true, stored: false, conversationKey, promoted: [] };
        }
        const members = bootstrapMembers(rumor.pubkey, rumor.tags);
        if (!members.includes(accountPubkey)) {
          return { handled: true, stored: false, conversationKey, promoted: [] };
        }
        const subject = parseGroupSubject(rumor.tags);
        const orderAt = messageOrderAt(rumor);
        const activityOrderAt =
          intake === 'live' || intake === 'recovery' || intake === 'local'
            ? Date.now()
            : orderAt;
        const senderIsContact = rumor.pubkey === accountPubkey ||
          (await tx
            .select({ pubkey: contacts.pubkey })
            .from(contacts)
            .where(
              and(
                eq(contacts.accountPubkey, accountPubkey),
                eq(contacts.pubkey, rumor.pubkey),
              ),
            )
            .limit(1)).length > 0;
        await tx.insert(conversations).values({
          accountPubkey,
          conversationKey,
          groupId,
          memberPubkeys: members,
          membersBootstrapOrderAt: orderAt,
          membersBootstrapEventId: rumor.id!,
          name: subject.status === 'valid' ? subject.name : null,
          nameOrderAt: subject.status === 'valid' ? orderAt : null,
          nameEventId: subject.status === 'valid' ? rumor.id! : null,
          createdAt: rumor.created_at,
          createdOrderAt: orderAt,
          updatedAt: Math.floor(activityOrderAt / 1000),
          updatedOrderAt: activityOrderAt,
          lastMessageAt: null,
          lastMessageOrderAt: null,
          lastMessageId: null,
          unreadCount: 0,
          hasReplied: senderIsContact,
        });
        const stored = await insertGroupMessage(
          tx,
          accountPubkey,
          conversationKey,
          rumor,
          options.sourceRelays,
          intake === 'local',
        );
        if (stored) {
          const promoted = await releasePrebootstrapRumors(
            tx,
            options,
            conversationKey,
            rumor,
            cursor,
          );
          await refreshConversationMessageState(tx, options, conversationKey, false);
          return { handled: true, stored, conversationKey, promoted };
        }
        return { handled: true, stored, conversationKey, promoted: [] };
      }

      if (!conversation.groupId) {
        return { handled: true, stored: false, conversationKey, promoted: [] };
      }
      const members = parseMembers(conversation.memberPubkeys);

      if (action.status === 'valid' && action.action.type === 'create') {
        if (
          conversation.membersBootstrapOrderAt == null ||
          !conversation.membersBootstrapEventId
        ) {
          if (intake !== 'local' || rumor.pubkey !== accountPubkey) {
            return { handled: true, stored: false, conversationKey, promoted: [] };
          }
          const expectedMembers = parseMembers(conversation.memberPubkeys);
          const receivedMembers = bootstrapMembers(rumor.pubkey, rumor.tags);
          if (expectedMembers.join('\n') !== receivedMembers.join('\n')) {
            return { handled: true, stored: false, conversationKey, promoted: [] };
          }
          await tx
            .update(conversations)
            .set({
              membersBootstrapOrderAt: messageOrderAt(rumor),
              membersBootstrapEventId: rumor.id!,
            })
            .where(
              and(
                eq(conversations.accountPubkey, accountPubkey),
                eq(conversations.conversationKey, conversationKey),
              ),
            );
          const stored = await insertGroupMessage(
            tx,
            accountPubkey,
            conversationKey,
            rumor,
            options.sourceRelays,
            true,
          );
          if (stored) {
            await updateNameState(tx, accountPubkey, conversationKey, rumor, false);
            await refreshConversationMessageState(tx, options, conversationKey, true);
          }
          return { handled: true, stored, conversationKey, promoted: [] };
        }
        const candidate = { orderAt: messageOrderAt(rumor), id: rumor.id! };
        const bootstrapCursor = {
          orderAt: conversation.membersBootstrapOrderAt,
          id: conversation.membersBootstrapEventId,
        };
        if (isMessageOrderNewer(candidate, bootstrapCursor)) {
          return { handled: true, stored: false, conversationKey, promoted: [] };
        }
        const stored = await insertGroupMessage(
          tx,
          accountPubkey,
          conversationKey,
          rumor,
          options.sourceRelays,
          intake === 'local',
        );
        if (stored) await refreshConversationMessageState(tx, options, conversationKey, false);
        return { handled: true, stored, conversationKey, promoted: [] };
      }

      if (action.status === 'valid' && actionIsMembership(action.action)) {
        const replayed = await replayKnownMembership(
          tx,
          options,
          conversationKey,
          conversation,
        );
        return {
          handled: true,
          stored: replayed.stored,
          conversationKey,
          promoted: replayed.promoted,
        };
      }

      if (!members.includes(rumor.pubkey)) {
        return { handled: true, stored: false, conversationKey, promoted: [] };
      }
      const stored = await insertGroupMessage(
        tx,
        accountPubkey,
        conversationKey,
        rumor,
        options.sourceRelays,
        intake === 'local',
      );
      if (!stored) return { handled: true, stored: false, conversationKey, promoted: [] };
      await updateNameState(tx, accountPubkey, conversationKey, rumor, finalized);
      await refreshConversationMessageState(
        tx,
        options,
        conversationKey,
        intake === 'live' || intake === 'recovery' || intake === 'local',
      );
      return { handled: true, stored: true, conversationKey, promoted: [] };
    });
    if (transactionResult.stored) {
      const ids = [...new Set([rumor.id!, ...transactionResult.promoted.map((item) => item.id!)])];
      const storedRows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.accountPubkey, accountPubkey),
            inArray(messages.id, ids),
          ),
        );
      for (const row of storedRows) mergeStoredMessageIntoTail(accountPubkey, row);
    }
    return transactionResult;
  }
}

export const groupReceiveService = new GroupReceiveService();
