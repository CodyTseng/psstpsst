import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { db } from '@/db/client';
import { messages } from '@/db/schema';
import { MESSAGES_PAGE_SIZE } from '@/lib/message-window';
import {
  getWarmedMessageTail,
  getWarmedMessageTailPresentation,
  invalidateWarmedMessageTail,
  replaceWarmedMessageTail,
  buildBubbleRenderItems,
  type PreparedBubbleRenderItem,
  type PreparedMessageTail,
} from '@/services/conversation/message-tail-cache';
import {
  aggregateReactionsByTarget,
  type ReactionAggregate,
} from '@/lib/nostr/reactions';
import {
  prepareMessagePresentation,
  type PreparedMessagePresentation,
} from '@/lib/chat/message-presentation';

/** How many messages to load per page. The newest page shows first; scrolling
 * back loads older pages. Conversations can hold hundreds of thousands of
 * messages, so we never load them all. Kept to ~one screenful: a smaller first
 * page means a lighter first paint (fewer bubbles, esp. media), and `loadOlder`
 * tops it up well before the top is reached. */
export { MESSAGES_PAGE_SIZE } from '@/lib/message-window';

/** A jump-to-message (anchored) window loads this many on **each** side of the
 * target up front — deliberately small. A small symmetric window keeps the target
 * near the centre at a low row index, so the list can land on it reliably (a short
 * `scrollToIndex` over few rows, no estimating across dozens of variable-height
 * media bubbles) and shows it immediately; both sides then page on demand as the
 * reader scrolls (`loadOlder` / `loadNewer`). */
export const ANCHOR_PAGE_SIZE = 10;

type MessageRow = typeof messages.$inferSelect;

const KINDS = [14, 15, 7];

/** A specific message to centre the window on. */
export type MessageAnchor = { orderAt: number; id: string };

export type PaginatedMessages = {
  /** Loaded window, oldest-first (ascending), ready for the inverted list. */
  messages: MessageRow[];
  /** Bubble rows from the same immutable window. A warmed tail returns the
   * already-filtered array prepared before navigation. */
  bubbleMessages: MessageRow[];
  /** Reactions aggregated by target from the same window. */
  reactionsByMessageId: Record<string, ReactionAggregate[]>;
  /** Stable rich-content models for every bubble in the window. */
  presentationsByMessageId: Record<string, PreparedMessagePresentation>;
  /** Stable invariant row models prepared with the warmed conversation tail. */
  bubbleRenderItemsById: Record<string, PreparedBubbleRenderItem>;
  /** Grow the window by one page of OLDER messages. */
  loadOlder: () => void;
  /** Grow the window by one page of NEWER messages (anchored mode only). */
  loadNewer: () => void;
  /** True while older pages may still exist. */
  hasMore: boolean;
  /** True while newer pages exist between the window and the live tail. */
  hasMoreNewer: boolean;
  /** True when the window is centred on an anchor (not following the tail). */
  anchored: boolean;
  /** Whether the active mode's query/queries have each resolved at least once. In
   * anchored mode this means **both** the older and newer sides are in — the
   * signal a jump-open waits on before positioning, so the target's row index is
   * final (not mid-load, when only one side has arrived). */
  windowLoaded: boolean;
  /** Re-centre the window on a specific message — loads a bounded page on each
   * side of it instead of everything back to the present (so jumping to a very
   * old message never loads the whole history). */
  focusAnchor: (anchor: MessageAnchor) => void;
  /** Drop the anchor and return to the live newest window. */
  jumpToTail: () => void;
};

/** `useLiveQuery` keeps both `data` and `updatedAt` from the previous dependency
 * set until the replacement query resolves. Track the key captured by each
 * resolution so stale rows are never treated as belonging to a new window. */
function useLiveQueryReadyForKey(
  updatedAt: Date | undefined,
  queryKey: string,
): boolean {
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  useEffect(() => {
    // This mirrors the asynchronous query result into render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (updatedAt !== undefined) setResolvedKey(queryKey);
    // Keyed only on the result timestamp on purpose. Depending on `queryKey`
    // would mark a new query ready while `updatedAt` still belongs to the old one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);
  return resolvedKey === queryKey;
}

/**
 * Windowed live query of a conversation's messages (incl. kind-7 reactions in
 * the same stream — the caller splits them out). Two modes:
 *
 * - **Tail** (default): the newest `limit` rows, grown older-ward one page at a
 *   time. The live tail is always included, so new messages append.
 * - **Anchored** ({@link focusAnchor}): a bounded page on each side of a target
 *   message, grown independently in both directions ({@link loadOlder} /
 *   {@link loadNewer}). Jumping to a message deep in a 1M-message history loads
 *   ~two pages around it — never the entire span back to the present.
 *
 * All three hooks stay instantiated, but `useLiveQuery` disables the inactive
 * mode entirely, so it owns no database listener or `LIMIT 0` read.
 */
export function useMessages(
  accountPubkey: string,
  conversationKey: string,
  liveDataEnabled = true,
  selfPubkey = accountPubkey,
  proximity = false,
): PaginatedMessages {
  const [anchor, setAnchor] = useState<MessageAnchor | null>(null);
  const [limit, setLimit] = useState(MESSAGES_PAGE_SIZE);
  const [olderCount, setOlderCount] = useState(ANCHOR_PAGE_SIZE);
  const [newerCount, setNewerCount] = useState(ANCHOR_PAGE_SIZE);
  const [tailEpoch, setTailEpoch] = useState(0);
  const tailLiveEnabled = liveDataEnabled && anchor === null;
  const anchorLiveEnabled = liveDataEnabled && anchor !== null;

  // A new conversation resets to the first tail page. Done during render (the
  // React-recommended "adjust state when a prop changes" pattern) rather than in
  // an effect, so the reset lands before paint — no frame of the prior thread's
  // pagination leaks through, and no cascading extra render.
  const [prevConversationKey, setPrevConversationKey] =
    useState(conversationKey);
  if (prevConversationKey !== conversationKey) {
    setPrevConversationKey(conversationKey);
    setAnchor(null);
    setLimit(MESSAGES_PAGE_SIZE);
    setOlderCount(ANCHOR_PAGE_SIZE);
    setNewerCount(ANCHOR_PAGE_SIZE);
  }

  const base = and(
    eq(messages.accountPubkey, accountPubkey),
    eq(messages.conversationKey, conversationKey),
    inArray(messages.kind, KINDS),
  );

  // Tail: newest N, oldest-ward. Its live query is disabled while anchored.
  const tail = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(base)
      .orderBy(desc(messages.orderAt), desc(messages.id))
      .limit(anchor ? 0 : limit),
    [accountPubkey, conversationKey, anchor ? 0 : limit, tailLiveEnabled],
    { enabled: tailLiveEnabled },
  );

  // Older side of the anchor (inclusive of the anchor itself), newest-first.
  const olderCond = anchor
    ? or(
        lt(messages.orderAt, anchor.orderAt),
        and(eq(messages.orderAt, anchor.orderAt), lte(messages.id, anchor.id)),
      )
    : sql`0`;
  const older = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(and(base, olderCond))
      .orderBy(desc(messages.orderAt), desc(messages.id))
      .limit(anchor ? olderCount : 0),
    [
      accountPubkey,
      conversationKey,
      anchor?.id ?? '',
      anchor?.orderAt ?? 0,
      anchor ? olderCount : 0,
      anchorLiveEnabled,
    ],
    { enabled: anchorLiveEnabled },
  );

  // Newer side of the anchor (exclusive), oldest-first.
  const newerCond = anchor
    ? or(
        gt(messages.orderAt, anchor.orderAt),
        and(eq(messages.orderAt, anchor.orderAt), gt(messages.id, anchor.id)),
      )
    : sql`0`;
  const newer = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(and(base, newerCond))
      .orderBy(asc(messages.orderAt), asc(messages.id))
      .limit(anchor ? newerCount : 0),
    [
      accountPubkey,
      conversationKey,
      anchor?.id ?? '',
      anchor?.orderAt ?? 0,
      anchor ? newerCount : 0,
      anchorLiveEnabled,
    ],
    { enabled: anchorLiveEnabled },
  );

  const tailQueryKey = `${accountPubkey}\u0000${conversationKey}\u0000${tailEpoch}`;
  const anchorQueryKey = `${accountPubkey}\u0000${conversationKey}\u0000${anchor?.orderAt ?? ''}\u0000${anchor?.id ?? ''}`;
  const tailReady = useLiveQueryReadyForKey(tail.updatedAt, tailQueryKey);
  const olderReady = useLiveQueryReadyForKey(older.updatedAt, anchorQueryKey);
  const newerReady = useLiveQueryReadyForKey(newer.updatedAt, anchorQueryKey);

  // `useLiveQuery` resolves its first result after mount. A normal open consumes
  // the asynchronously warmed in-memory tail when present; a miss returns an
  // empty window without touching SQLite synchronously, and the live result fills
  // it after the route shell has already painted. `data` itself cannot signal
  // readiness because Drizzle initializes collection queries to `[]` and retains
  // old rows across dependency changes.
  const tailWindow = useMemo<{
    rows: MessageRow[];
    prepared: PreparedMessageTail | null;
  }>(() => {
    if (anchor) return { rows: tail.data ?? [], prepared: null };
    if (tailReady) {
      replaceWarmedMessageTail(accountPubkey, conversationKey, tail.data);
      return {
        rows: tail.data,
        prepared: getWarmedMessageTailPresentation(
          accountPubkey,
          conversationKey,
          selfPubkey,
          proximity,
        ),
      };
    }
    const prepared = getWarmedMessageTailPresentation(
      accountPubkey,
      conversationKey,
      selfPubkey,
      proximity,
    );
    if (prepared !== null) {
      return { rows: prepared.rowsNewestFirst, prepared };
    }
    const warmed = getWarmedMessageTail(accountPubkey, conversationKey);
    if (warmed !== null) return { rows: warmed, prepared: null };
    // Never run synchronous SQLite during a route render. If an entry point did
    // not warm this conversation, paint the screen shell immediately and let the
    // already-subscribed live query fill the bounded window on its next result.
    return { rows: [], prepared: null };
  }, [
    anchor,
    tailReady,
    tail.data,
    accountPubkey,
    conversationKey,
    selfPubkey,
    proximity,
  ]);
  const tailRows = tailWindow.rows;
  const olderRows = useMemo(() => older.data ?? [], [older.data]);
  const newerRows = useMemo(() => newer.data ?? [], [newer.data]);

  const ascending = useMemo(() => {
    if (!anchor) {
      return tailWindow.prepared?.rowsNewestFirst === tailRows
        ? tailWindow.prepared.rowsAscending
        : [...tailRows].reverse();
    }
    return [...olderRows].reverse().concat(newerRows);
  }, [anchor, tailRows, tailWindow.prepared, olderRows, newerRows]);
  const bubbleMessages = useMemo(
    () =>
      !anchor && tailWindow.prepared?.rowsAscending === ascending
        ? tailWindow.prepared.messagesAscending
        : ascending.filter((row) => row.kind !== 7),
    [anchor, ascending, tailWindow.prepared],
  );
  const reactionsByMessageId = useMemo(
    () =>
      !anchor && tailWindow.prepared?.rowsAscending === ascending
        ? tailWindow.prepared.reactionsByMessageId
        : aggregateReactionsByTarget(ascending, selfPubkey, proximity),
    [anchor, ascending, selfPubkey, proximity, tailWindow.prepared],
  );
  const presentationsByMessageId = useMemo(() => {
    if (!anchor && tailWindow.prepared?.rowsAscending === ascending) {
      return tailWindow.prepared.presentationsByMessageId;
    }
    const presentations: Record<string, PreparedMessagePresentation> = {};
    for (const row of bubbleMessages) {
      presentations[row.id] = prepareMessagePresentation({
        messageId: row.id,
        kind: row.kind,
        content: row.content,
        tags: row.tags,
      });
    }
    return presentations;
  }, [anchor, ascending, bubbleMessages, tailWindow.prepared]);
  const bubbleRenderItemsById = useMemo(
    () =>
      !anchor && tailWindow.prepared?.rowsAscending === ascending
        ? tailWindow.prepared.bubbleRenderItemsById
        : buildBubbleRenderItems(
            bubbleMessages,
            presentationsByMessageId,
            reactionsByMessageId,
          ),
    [
      anchor,
      ascending,
      bubbleMessages,
      presentationsByMessageId,
      reactionsByMessageId,
      tailWindow.prepared,
    ],
  );

  const hasMore = anchor
    ? olderRows.length >= olderCount
    : tailRows.length >= limit;
  const hasMoreNewer = anchor ? newerRows.length >= newerCount : false;
  // Anchored mode needs both sides in before a jump positions, so the target's
  // index is final. Readiness is keyed because live-query state survives deps.
  const windowLoaded = anchor ? olderReady && newerReady : tailReady;

  const loadOlder = useCallback(() => {
    if (anchor)
      setOlderCount((cnt) =>
        olderRows.length >= cnt ? cnt + MESSAGES_PAGE_SIZE : cnt,
      );
    else setLimit((l) => (tailRows.length >= l ? l + MESSAGES_PAGE_SIZE : l));
  }, [anchor, olderRows.length, tailRows.length]);

  const loadNewer = useCallback(() => {
    if (anchor)
      setNewerCount((cnt) =>
        newerRows.length >= cnt ? cnt + MESSAGES_PAGE_SIZE : cnt,
      );
  }, [anchor, newerRows.length]);

  const focusAnchor = useCallback((a: MessageAnchor) => {
    setAnchor(a);
    setOlderCount(ANCHOR_PAGE_SIZE);
    setNewerCount(ANCHOR_PAGE_SIZE);
  }, []);

  const jumpToTail = useCallback(() => {
    invalidateWarmedMessageTail(accountPubkey, conversationKey);
    setAnchor(null);
    setLimit(MESSAGES_PAGE_SIZE);
    // The tail query was disabled while anchored. Force readiness to
    // belong to its new activation instead of reusing the anchored-era result.
    setTailEpoch((epoch) => epoch + 1);
  }, [accountPubkey, conversationKey]);

  return {
    messages: ascending,
    bubbleMessages,
    reactionsByMessageId,
    presentationsByMessageId,
    bubbleRenderItemsById,
    loadOlder,
    loadNewer,
    hasMore,
    hasMoreNewer,
    anchored: !!anchor,
    windowLoaded,
    focusAnchor,
    jumpToTail,
  };
}

/**
 * Fetch specific messages by id (live). Used to resolve reply previews whose
 * target sits outside the loaded window — those messages are still in the local
 * DB, just not in the current page. Returns a map id → row.
 */
export function useMessagesByIds(
  accountPubkey: string,
  ids: string[],
  liveDataEnabled = true,
): Record<string, MessageRow> {
  // inArray([]) is unsafe; use a never-matching sentinel id when empty.
  const safeIds = ids.length > 0 ? ids : [' '];
  const queryEnabled = liveDataEnabled && ids.length > 0;
  const { data } = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, accountPubkey),
          inArray(messages.id, safeIds),
        ),
      ),
    [accountPubkey, safeIds.join(','), queryEnabled],
    { enabled: queryEnabled },
  );

  return useMemo(() => {
    const map: Record<string, MessageRow> = {};
    for (const row of data ?? []) map[row.id] = row;
    return map;
  }, [data]);
}
