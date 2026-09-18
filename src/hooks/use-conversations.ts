import { and, count, desc, eq, gt } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/db/client';
import { conversations, messages } from '@/db/schema';
import { useUnreadCount, useUnreadIndicatorsEnabled } from '@/stores/unread-count.store';

export type ConversationWithLast = {
  conversation: typeof conversations.$inferSelect;
  lastMessageContent: string | null;
  lastMessageKind: number | null;
  lastMessageTags: string[][] | null;
  lastMessageSenderPubkey: string | null;
};

/**
 * Conversations the user has actively engaged with — the **contact** view.
 * No message join (lighter / fewer re-renders) since Contacts page just shows
 * avatar + name.
 */
export function useContactConversations(accountPubkey: string) {
  const { data } = useLiveQuery(
    db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.deleted, false),
          eq(conversations.hasReplied, true),
        ),
      )
      .orderBy(desc(conversations.lastMessageOrderAt)),
    [accountPubkey],
  );
  return data ?? [];
}

function selectConversationsWithLast(accountPubkey: string, onlyReplied: boolean) {
  return db
    .select({
      conversation: conversations,
      lastMessageContent: messages.content,
      lastMessageKind: messages.kind,
      lastMessageTags: messages.tags,
      lastMessageSenderPubkey: messages.senderPubkey,
    })
    .from(conversations)
    // Match the owning account too: the same `lastMessageId` can exist under a
    // different account (two accounts DMing each other share a rumor id), so an
    // id-only join could pull the wrong account's row.
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
        onlyReplied
          ? eq(conversations.hasReplied, true)
          : eq(conversations.hasReplied, false),
      ),
    )
    // Pinned conversations float to the top (pinned=1 sorts before 0 under
    // DESC); within each group, most-recent first. Conversation counts are
    // small, so the in-memory sort this adds over the lastMessageOrderAt index is
    // negligible.
    .orderBy(desc(conversations.pinned), desc(conversations.lastMessageOrderAt));
}

export type ConversationListResult = {
  conversations: ConversationWithLast[];
  /** False until the live query first resolves — `data` starts as `[]`, so use
   * this (not `conversations.length`) to tell "still loading" from "empty" and
   * avoid flashing an empty state. See docs/DESIGN.md §11. */
  loaded: boolean;
};

export type ConversationResult = {
  conversation: typeof conversations.$inferSelect | null;
  /** False until the live query has resolved, so callers can distinguish a
   * missing row from a row whose request status is not known yet. */
  loaded: boolean;
};

/**
 * Session-memory warm cache for the main inbox. Resolved live results refresh
 * it; cold database reads stay asynchronous so render never blocks on I/O.
 */
const inboxWarmCache = new Map<string, ConversationWithLast[]>();

/** Last reconciled list per account — the baseline the next resolve is merged
 * against. Module-scoped like the warm cache above; reconciliation is
 * idempotent, so a re-render merging the same input is a no-op. */
const inboxReconciledCache = new Map<string, ConversationWithLast[]>();

function warmMainInbox(accountPubkey: string): ConversationWithLast[] {
  return inboxWarmCache.get(accountPubkey) ?? [];
}

/** Row-content equality for reconciliation. `lastMessageTags` gets a fresh array
 * identity on every resolve, so compare it by value; conversation columns are
 * all scalars, so a field-wise `!==` is exact. */
function sameConversationWithLast(a: ConversationWithLast, b: ConversationWithLast): boolean {
  if (
    a.lastMessageContent !== b.lastMessageContent ||
    a.lastMessageKind !== b.lastMessageKind ||
    a.lastMessageSenderPubkey !== b.lastMessageSenderPubkey ||
    JSON.stringify(a.lastMessageTags) !== JSON.stringify(b.lastMessageTags)
  ) {
    return false;
  }

  const ac = a.conversation;
  const bc = b.conversation;
  for (const key of Object.keys(ac) as (keyof typeof ac)[]) {
    if (ac[key] !== bc[key]) return false;
  }
  return true;
}

/**
 * Reuse unchanged rows — and the whole array when nothing changed — across live
 * resolves. The inbox stays mounted below a pushed chat and its query re-runs on
 * every conversations-table write mid-transition; stable identities let the
 * memoized rows (and a fully unchanged list) skip those renders.
 */
function reconcileConversationList(
  previous: ConversationWithLast[],
  next: ConversationWithLast[],
): ConversationWithLast[] {
  if (previous === next || next.length === 0) return next;

  const previousByKey = new Map(
    previous.map(
      (item) =>
        [
          `${item.conversation.accountPubkey}:${item.conversation.conversationKey}`,
          item,
        ] as const,
    ),
  );
  const merged = next.map((item) => {
    const prior = previousByKey.get(
      `${item.conversation.accountPubkey}:${item.conversation.conversationKey}`,
    );
    return prior && sameConversationWithLast(prior, item) ? prior : item;
  });

  const unchanged =
    merged.length === previous.length &&
    merged.every((item, index) => item === previous[index]);
  return unchanged ? previous : merged;
}

/** Conversations the user has actively engaged with (replied) — the main inbox. */
export function useMainInboxConversations(accountPubkey: string): ConversationListResult {
  const { data, updatedAt } = useLiveQuery(selectConversationsWithLast(accountPubkey, true), [
    accountPubkey,
    'replied',
  ]);
  // `useLiveQuery` keeps the *previous* account's `data` across an account change
  // until the new query resolves, and `updatedAt` never resets — so neither alone
  // tells us the live result is for *this* account. A content check can't either
  // (an account that's genuinely empty is indistinguishable from "not loaded").
  // So track which account the live result is for: `updatedAt` changes on every
  // (re)resolve, and the latest closure carries the account it resolved for.
  const [liveAccount, setLiveAccount] = useState<string | null>(null);
  useEffect(() => {
    // Mirror the live query's resolved-for account into render state — a
    // legitimate external-sync effect (the query resolves asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (updatedAt !== undefined) setLiveAccount(accountPubkey);
    // Keyed on `updatedAt` only — on purpose. Adding `accountPubkey` would fire on
    // switch with the *stale* (still-defined) `updatedAt` and mark the new account
    // loaded before its query has actually run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);
  const liveReady = liveAccount === accountPubkey;
  // Until the live query resolves for this account, reuse only a session-warm
  // result. A cold account returns the standard quiet loading placeholder.
  const conversationList = useMemo(() => {
    const source = liveReady ? data : warmMainInbox(accountPubkey);
    const reconciled = reconcileConversationList(
      inboxReconciledCache.get(accountPubkey) ?? [],
      source,
    );
    inboxReconciledCache.set(accountPubkey, reconciled);
    if (liveReady) inboxWarmCache.set(accountPubkey, reconciled);
    return reconciled;
  }, [liveReady, data, accountPubkey]);
  return { conversations: conversationList, loaded: liveReady };
}

/** Conversations the user has not yet replied to — message requests. */
export function useRequestConversations(accountPubkey: string): ConversationListResult {
  const { data, updatedAt } = useLiveQuery(selectConversationsWithLast(accountPubkey, false), [
    accountPubkey,
    'request',
  ]);
  return { conversations: data ?? [], loaded: updatedAt !== undefined };
}

/**
 * Total unread messages across the main inbox (replied, not deleted), excluding
 * muted conversations — drives the Chats tab badge. Sums `unreadCount` so it
 * reflects message count, not conversation count.
 */
export function useTotalUnread(accountPubkey: string, liveDataEnabled = true): number {
  return useUnreadCount(accountPubkey, liveDataEnabled);
}

/** Count of pending request conversations (read or not) — drives the Contacts
 * "pending requests" card and matches the Requests list length. */
export function useRequestCount(accountPubkey: string): number {
  const { data } = useLiveQuery(
    db
      .select({ n: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.deleted, false),
          eq(conversations.hasReplied, false),
        ),
      ),
    [accountPubkey],
  );
  return data?.[0]?.n ?? 0;
}

/**
 * Count of pending requests that still have unread messages — drives the
 * Contacts **tab badge**. A request the user has opened (read) but not yet
 * replied to stays in the Requests list, but no longer pings the badge.
 */
export function useUnreadRequestCount(accountPubkey: string): number {
  const indicatorsEnabled = useUnreadIndicatorsEnabled();
  const { data } = useLiveQuery(
    db
      .select({ n: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.deleted, false),
          eq(conversations.hasReplied, false),
          gt(conversations.unreadCount, 0),
        ),
      ),
    [accountPubkey],
  );
  return indicatorsEnabled ? (data?.[0]?.n ?? 0) : 0;
}

export function useConversation(
  accountPubkey: string,
  conversationKey: string,
  liveDataEnabled = true,
): ConversationResult {
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      )
      .limit(1),
    [accountPubkey, conversationKey, liveDataEnabled],
    { enabled: liveDataEnabled },
  );
  const targetKey = `${accountPubkey}:${conversationKey}`;
  const [resolvedTargetKey, setResolvedTargetKey] = useState<string | null>(null);
  useEffect(() => {
    if (updatedAt === undefined) return;
    // `useLiveQuery` retains the previous result and timestamp when its deps
    // change. Only a new timestamp proves this target's query has resolved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedTargetKey(targetKey);
    // Keyed on `updatedAt` only on purpose: including targetKey would mark a
    // changed target resolved while the hook still carries the prior result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);
  const loaded = resolvedTargetKey === targetKey;
  return {
    conversation: loaded ? (data?.[0] ?? null) : null,
    loaded,
  };
}
