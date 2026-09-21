import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { db } from '@/db/client';
import { chatPerformanceNow, logChatPerformance } from '@/lib/perf/chat-performance';
import { messages } from '@/db/schema';
import {
  MESSAGE_HISTORY_APPEND_SIZE,
  MESSAGE_HISTORY_FETCH_SIZE,
  MESSAGE_HISTORY_PREFETCH_THRESHOLD,
  MESSAGES_PAGE_SIZE,
  mergeNewestFirstRows,
} from '@/lib/message-window';
import {
  getWarmedMessageTail,
  getWarmedMessageTailPresentation,
  invalidateWarmedMessageTail,
  replaceWarmedMessageTail,
  type PreparedBubbleRenderItem,
  type PreparedMessageTail,
} from '@/services/conversation/message-tail-cache';
import {
  aggregateReactionsByTarget,
  type ReactionAggregate,
} from '@/lib/nostr/reactions';
import type { PreparedMessagePresentation } from '@/lib/chat/message-presentation';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';

/** How many message/reaction rows to load per page. The newest page shows first;
 * scrolling back loads older cursor pages. A smaller first page keeps the first
 * paint light, and short pages automatically top up until the viewport is full. */
export { MESSAGES_PAGE_SIZE } from '@/lib/message-window';

/** A jump-to-message (anchored) window loads this many on **each** side of the
 * target up front — deliberately small. A small symmetric window keeps the target
 * near the centre at a low row index, so the list can land on it reliably (a short
 * `scrollToIndex` over few rows, no estimating across dozens of variable-height
 * media bubbles) and shows it immediately; both sides then page on demand as the
 * reader scrolls (`loadOlder` / `loadNewer`). */
export const ANCHOR_PAGE_SIZE = 10;

type MessageRow = typeof messages.$inferSelect;
export type MessageBoundary = Pick<MessageRow, 'createdAt' | 'senderPubkey'>;

type AnchorWindow = {
  olderRows: MessageRow[];
  newerRows: MessageRow[];
  olderPrefetch: MessageRow[];
  newerPrefetch: MessageRow[];
  olderHasMore: boolean;
  newerHasMore: boolean;
  olderRequestInFlight: boolean;
  newerRequestInFlight: boolean;
  revealOlderOnArrival: boolean;
  revealNewerOnArrival: boolean;
  olderPrefetchFailed: boolean;
  newerPrefetchFailed: boolean;
  loaded: boolean;
};

const KINDS = [14, 15, 7];
const EMPTY_MESSAGE_ROWS: MessageRow[] = [];
const EMPTY_PRESENTATIONS: Record<string, PreparedMessagePresentation> = {};
const EMPTY_RENDER_ITEMS: Record<string, PreparedBubbleRenderItem> = {};

/** A specific message to centre the window on. */
export type MessageAnchor = { orderAt: number; id: string };

export type PaginatedMessages = {
  /** Exposed history, oldest-first (ascending), ready for the inverted list. */
  messages: MessageRow[];
  /** Bubble rows from the same immutable history. A warmed tail returns the
   * already-filtered array prepared before navigation. */
  bubbleMessages: MessageRow[];
  /** Reactions aggregated by target from the exposed history. */
  reactionsByMessageId: Record<string, ReactionAggregate[]>;
  /** Stable rich-content models for every exposed bubble. */
  presentationsByMessageId: Record<string, PreparedMessagePresentation>;
  /** Stable invariant row models prepared with the warmed conversation tail. */
  bubbleRenderItemsById: Record<string, PreparedBubbleRenderItem>;
  /** Expose one more page of OLDER messages. */
  loadOlder: () => void;
  /** Grow the window by one page of NEWER messages (anchored mode only). */
  loadNewer: () => void;
  /** True while older pages may still exist. */
  hasMore: boolean;
  /** True while an older page is being read. */
  loadingOlder: boolean;
  /** True while a historical window is moving toward the live tail. */
  loadingNewer: boolean;
  /** True while newer pages exist between the window and the live tail. */
  hasMoreNewer: boolean;
  /** Date and sender of the bubble beyond the oldest exposed row. Null means
   * the exposed row is the true start of history; undefined is unknown. */
  oldestBoundary: MessageBoundary | null | undefined;
  /** Changes only for an explicit return-to-latest command. */
  tailJumpVersion: number;
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
 * Paginated query of a conversation's messages (incl. kind-7 reactions in
 * the same stream — the caller splits them out). Two modes:
 *
 * - **Tail** (default): a fixed live page at the newest edge plus immutable
 *   cursor pages grown older-ward. The live page never becomes more expensive
 *   as the reader moves deeper into history.
 * - **Anchored** ({@link focusAnchor}): a bounded page on each side of a target
 *   message, grown independently in both directions ({@link loadOlder} /
 *   {@link loadNewer}). Jumping to a message deep in a 1M-message history loads
 *   ~two pages around it — never the entire span back to the present.
 *
 * The live tail stays bounded. Anchored windows use retained, keyset-paginated
 * session caches rather than growing `LIMIT` queries, and are released when the
 * mounted conversation session ends.
 */
export function useMessages(
  accountPubkey: string,
  conversationKey: string,
  liveDataEnabled = true,
  selfPubkey = accountPubkey,
  proximity = false,
): PaginatedMessages {
  const [anchor, setAnchor] = useState<MessageAnchor | null>(null);
  const [tailHistory, setTailHistory] = useState<MessageRow[]>([]);
  const [tailOlderPrefetch, setTailOlderPrefetch] = useState<MessageRow[]>([]);
  const [tailHasMore, setTailHasMore] = useState(true);
  const [tailLoadingOlder, setTailLoadingOlder] = useState(false);
  const [tailOlderBoundary, setTailOlderBoundary] = useState<
    MessageBoundary | null | undefined
  >(undefined);
  const [anchorOlderBoundary, setAnchorOlderBoundary] = useState<
    MessageBoundary | null | undefined
  >(undefined);
  const [anchorWindows, setAnchorWindows] = useState<Map<string, AnchorWindow>>(
    () => new Map(),
  );
  const anchorWindowsRef = useRef(anchorWindows);
  const [tailEpoch, setTailEpoch] = useState(0);
  const tailLiveEnabled = liveDataEnabled && anchor === null;
  const sessionKey = `${accountPubkey}\u0000${conversationKey}`;

  // A new conversation resets to the first tail page. Done during render (the
  // React-recommended "adjust state when a prop changes" pattern) rather than in
  // an effect, so the reset lands before paint — no frame of the prior thread's
  // pagination leaks through, and no cascading extra render.
  const [previousSessionKey, setPreviousSessionKey] = useState(sessionKey);
  if (previousSessionKey !== sessionKey) {
    setPreviousSessionKey(sessionKey);
    setAnchor(null);
    setTailHistory([]);
    setTailOlderPrefetch([]);
    setTailHasMore(true);
    setTailLoadingOlder(false);
    setTailOlderBoundary(undefined);
    setAnchorOlderBoundary(undefined);
    setAnchorWindows(new Map());
  }

  const base = useMemo(
    () =>
      and(
        eq(messages.accountPubkey, accountPubkey),
        eq(messages.conversationKey, conversationKey),
        inArray(messages.kind, KINDS),
      ),
    [accountPubkey, conversationKey],
  );
  const messageBase = useMemo(
    () =>
      and(
        eq(messages.accountPubkey, accountPubkey),
        eq(messages.conversationKey, conversationKey),
        inArray(messages.kind, [14, 15]),
      ),
    [accountPubkey, conversationKey],
  );
  const readOlderMessageBoundary = useCallback(
    async (cursor: MessageRow): Promise<MessageBoundary | null> => {
      const rows = await db
        .select({ createdAt: messages.createdAt, senderPubkey: messages.senderPubkey })
        .from(messages)
        .where(
          and(
            messageBase,
            or(
              lt(messages.orderAt, cursor.orderAt),
              and(eq(messages.orderAt, cursor.orderAt), gt(messages.id, cursor.id)),
            ),
          ),
        )
        .orderBy(desc(messages.orderAt), asc(messages.id))
        .limit(1);
      return rows[0] ?? null;
    },
    [messageBase],
  );

  // Tail: a bounded live overlap used to absorb bursts and seed older prefetch.
  const tail = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(base)
      .orderBy(desc(messages.orderAt), asc(messages.id))
      .limit(anchor ? 0 : MESSAGE_HISTORY_FETCH_SIZE + 1),
    [
      accountPubkey,
      conversationKey,
      anchor ? 0 : MESSAGE_HISTORY_FETCH_SIZE + 1,
      tailLiveEnabled,
      tailEpoch,
    ],
    { enabled: tailLiveEnabled },
  );

  const tailQueryKey = `${accountPubkey}\u0000${conversationKey}\u0000${tailEpoch}`;
  const tailReady = useLiveQueryReadyForKey(tail.updatedAt, tailQueryKey);

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
      const prepared = getWarmedMessageTailPresentation(
        accountPubkey,
        conversationKey,
        selfPubkey,
        proximity,
      );
      return {
        rows: prepared?.rowsNewestFirst ?? tail.data.slice(0, MESSAGES_PAGE_SIZE),
        prepared,
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
  const anchorKey = anchor
    ? `${sessionKey}\u0000${anchor.orderAt}\u0000${anchor.id}`
    : null;
  const activeAnchorWindow = anchorKey ? anchorWindows.get(anchorKey) : undefined;
  const olderRows = activeAnchorWindow?.olderRows ?? EMPTY_MESSAGE_ROWS;
  const newerRows = activeAnchorWindow?.newerRows ?? EMPTY_MESSAGE_ROWS;

  const tailLoadedNewestFirst = useMemo(
    () => mergeNewestFirstRows(tailRows, tailHistory),
    [tailHistory, tailRows],
  );
  const tailNewestFirst = tailLoadedNewestFirst;
  const tailLoadedNewestFirstRef = useRef(tailLoadedNewestFirst);
  useLayoutEffect(() => {
    tailLoadedNewestFirstRef.current = tailLoadedNewestFirst;
  }, [tailLoadedNewestFirst]);
  const tailOlderPrefetchRef = useRef(tailOlderPrefetch);
  useLayoutEffect(() => {
    tailOlderPrefetchRef.current = tailOlderPrefetch;
  }, [tailOlderPrefetch]);
  const tailLoadGenerationRef = useRef(0);
  const pendingPageTrace = useRef<{ startedAt: number; rows: number } | null>(null);
  useLayoutEffect(() => {
    const trace = pendingPageTrace.current;
    if (!trace || tailLoadingOlder) return;
    logChatPerformance('history.committed', {
      elapsedMs: Math.round(chatPerformanceNow() - trace.startedAt),
      fetchedRows: trace.rows,
      retainedRows: tailHistory.length,
      cachedRows: tailOlderPrefetch.length,
    });
    pendingPageTrace.current = null;
  }, [tailHistory, tailLoadingOlder, tailOlderPrefetch]);
  const tailLoadingRef = useRef(false);
  const tailPrefetchingRef = useRef(false);
  const tailRevealAfterPrefetchRef = useRef(false);
  const tailPageCommitPendingRef = useRef(false);
  useLayoutEffect(() => {
    // Keep the request locked until its transitioned rows and loading state
    // have committed. Unlocking at promise resolution can reuse the old cursor.
    tailLoadingRef.current = tailLoadingOlder;
  }, [tailLoadingOlder]);
  useLayoutEffect(() => {
    tailPageCommitPendingRef.current = false;
  }, [tailHistory, tailOlderPrefetch]);
  const previousTailRowsRef = useRef(tailRows);
  const boundaryLoadGenerationRef = useRef(0);
  const tailGapGenerationRef = useRef(0);
  const activeSessionRef = useRef(sessionKey);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (activeSessionRef.current === sessionKey) return;
    activeSessionRef.current = sessionKey;
    anchorWindowsRef.current = new Map();
    tailLoadGenerationRef.current += 1;
    boundaryLoadGenerationRef.current += 1;
    tailGapGenerationRef.current += 1;
    tailLoadingRef.current = false;
    tailPrefetchingRef.current = false;
    tailRevealAfterPrefetchRef.current = false;
    tailPageCommitPendingRef.current = false;
    previousTailRowsRef.current = tailRows;
  }, [sessionKey, tailRows]);

  const updateAnchorWindow = useCallback(
    (key: string, update: (current: AnchorWindow | undefined) => AnchorWindow) => {
      if (!mountedRef.current) return;
      const nextWindow = update(anchorWindowsRef.current.get(key));
      const nextWindows = new Map(anchorWindowsRef.current);
      nextWindows.set(key, nextWindow);
      anchorWindowsRef.current = nextWindows;
      startTransition(() => setAnchorWindows(nextWindows));
    },
    [],
  );

  useEffect(() => {
    if (!anchor || !anchorKey || !liveDataEnabled) return;
    const existing = anchorWindowsRef.current.get(anchorKey);
    if (existing?.loaded || existing?.olderRequestInFlight) return;
    updateAnchorWindow(anchorKey, () => ({
      olderRows: [],
      newerRows: [],
      olderPrefetch: [],
      newerPrefetch: [],
      olderHasMore: true,
      newerHasMore: true,
      olderRequestInFlight: true,
      newerRequestInFlight: true,
      revealOlderOnArrival: false,
      revealNewerOnArrival: false,
      olderPrefetchFailed: false,
      newerPrefetchFailed: false,
      loaded: false,
    }));
    let active = true;
    const olderCondition = or(
      lt(messages.orderAt, anchor.orderAt),
      and(eq(messages.orderAt, anchor.orderAt), gte(messages.id, anchor.id)),
    );
    const newerCondition = or(
      gt(messages.orderAt, anchor.orderAt),
      and(eq(messages.orderAt, anchor.orderAt), lt(messages.id, anchor.id)),
    );
    void Promise.all([
      db
        .select()
        .from(messages)
        .where(and(base, olderCondition))
        .orderBy(desc(messages.orderAt), asc(messages.id))
        .limit(MESSAGE_HISTORY_FETCH_SIZE + 1),
      db
        .select()
        .from(messages)
        .where(and(base, newerCondition))
        .orderBy(asc(messages.orderAt), desc(messages.id))
        .limit(MESSAGE_HISTORY_FETCH_SIZE + 1),
    ]).then(([olderResult, newerResult]) => {
      if (!active) return;
      updateAnchorWindow(anchorKey, () => ({
        olderRows: olderResult.slice(0, ANCHOR_PAGE_SIZE),
        newerRows: newerResult.slice(0, ANCHOR_PAGE_SIZE),
        olderPrefetch: olderResult.slice(ANCHOR_PAGE_SIZE, MESSAGE_HISTORY_FETCH_SIZE),
        newerPrefetch: newerResult.slice(ANCHOR_PAGE_SIZE, MESSAGE_HISTORY_FETCH_SIZE),
        olderHasMore: olderResult.length > MESSAGE_HISTORY_FETCH_SIZE,
        newerHasMore: newerResult.length > MESSAGE_HISTORY_FETCH_SIZE,
        olderRequestInFlight: false,
        newerRequestInFlight: false,
        revealOlderOnArrival: false,
        revealNewerOnArrival: false,
        olderPrefetchFailed: false,
        newerPrefetchFailed: false,
        loaded: true,
      }));
    }).catch(() => {
      if (!active) return;
      updateAnchorWindow(anchorKey, (current) => ({
        ...(current ?? {
          olderRows: [],
          newerRows: [],
          olderPrefetch: [],
          newerPrefetch: [],
          olderHasMore: false,
          newerHasMore: false,
          revealOlderOnArrival: false,
          revealNewerOnArrival: false,
          olderPrefetchFailed: false,
          newerPrefetchFailed: false,
        }),
        olderRequestInFlight: false,
        newerRequestInFlight: false,
        loaded: true,
      }));
    });
    return () => {
      active = false;
      const current = anchorWindowsRef.current.get(anchorKey);
      if (current && !current.loaded) {
        updateAnchorWindow(anchorKey, (window) => ({
          ...window!,
          olderRequestInFlight: false,
          newerRequestInFlight: false,
        }));
      }
    };
  }, [anchor, anchorKey, base, liveDataEnabled, updateAnchorWindow]);

  useEffect(() => {
    if (!tailReady || anchor) return;
    const previous = previousTailRowsRef.current;
    previousTailRowsRef.current = tailRows;
    const authoritativeRows = tail.data.slice(0, MESSAGE_HISTORY_FETCH_SIZE);
    const currentTailIds = new Set(tailRows.map((row) => row.id));
    const exposedIds = new Set(tailLoadedNewestFirst.map((row) => row.id));
    const rowsToExpose: MessageRow[] = [];
    if (previous.length > 0) {
      const shiftedOut = previous.filter((row) => !currentTailIds.has(row.id));
      if (shiftedOut.length > 0) {
        rowsToExpose.push(...shiftedOut);
        for (const row of shiftedOut) exposedIds.add(row.id);
      }
      const previousNewest = previous[0];
      const liveOverlap = authoritativeRows.some((row) =>
        previous.some((oldRow) => oldRow.id === row.id),
      );
      for (const row of authoritativeRows.slice(MESSAGES_PAGE_SIZE)) {
        if (isMessageOrderNewer(row, previousNewest) && !exposedIds.has(row.id)) {
          rowsToExpose.push(row);
          exposedIds.add(row.id);
        }
      }
      if (!liveOverlap && authoritativeRows.length === MESSAGE_HISTORY_FETCH_SIZE) {
        const generation = ++tailGapGenerationRef.current;
        const initialCursor = authoritativeRows[authoritativeRows.length - 1];
        void (async () => {
          const recovered: MessageRow[] = [];
          let cursor = initialCursor;
          while (true) {
            const pageResult = await db
              .select()
              .from(messages)
              .where(and(
                base,
                or(
                  lt(messages.orderAt, cursor.orderAt),
                  and(eq(messages.orderAt, cursor.orderAt), gt(messages.id, cursor.id)),
                ),
                or(
                  gt(messages.orderAt, previousNewest.orderAt),
                  and(
                    eq(messages.orderAt, previousNewest.orderAt),
                    lt(messages.id, previousNewest.id),
                  ),
                ),
              ))
              .orderBy(desc(messages.orderAt), asc(messages.id))
              .limit(MESSAGE_HISTORY_FETCH_SIZE + 1);
            if (tailGapGenerationRef.current !== generation) return;
            const page = pageResult.slice(0, MESSAGE_HISTORY_FETCH_SIZE);
            recovered.push(...page);
            if (pageResult.length <= MESSAGE_HISTORY_FETCH_SIZE || page.length === 0) break;
            cursor = page[page.length - 1];
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          if (tailGapGenerationRef.current !== generation || recovered.length === 0) return;
          startTransition(() => {
            setTailHistory((current) => mergeNewestFirstRows(current, recovered));
          });
        })().catch(() => {});
      }
    }
    if (rowsToExpose.length > 0) {
      startTransition(() => {
        setTailHistory((current) => mergeNewestFirstRows(current, rowsToExpose));
      });
    }
    const overflow = authoritativeRows
      .slice(MESSAGES_PAGE_SIZE)
      .filter((row) => !exposedIds.has(row.id));
    startTransition(() => {
      if (overflow.length > 0) {
        setTailOlderPrefetch((current) => mergeNewestFirstRows(overflow, current));
      }
      setTailHasMore(tail.data.length > MESSAGE_HISTORY_FETCH_SIZE);
    });
  }, [anchor, base, tail.data, tailLoadedNewestFirst, tailReady, tailRows]);

  useEffect(() => {
    if (!tailReady || anchor) return;
    const oldestMessage = [...tailNewestFirst].reverse().find((row) => row.kind !== 7);
    const generation = ++boundaryLoadGenerationRef.current;
    if (!oldestMessage) {
      startTransition(() => setTailOlderBoundary(null));
      return;
    }
    const cachedBoundary = tailOlderPrefetch.find((row) => row.kind !== 7);
    if (cachedBoundary) {
      startTransition(() =>
        setTailOlderBoundary({
          createdAt: cachedBoundary.createdAt,
          senderPubkey: cachedBoundary.senderPubkey,
        }),
      );
      return;
    }
    void readOlderMessageBoundary(oldestMessage).then((createdAt) => {
      if (boundaryLoadGenerationRef.current !== generation) return;
      startTransition(() => setTailOlderBoundary(createdAt));
    }).catch(() => {});
  }, [anchor, readOlderMessageBoundary, tailNewestFirst, tailOlderPrefetch, tailReady]);

  useEffect(() => {
    if (!anchor || !activeAnchorWindow?.loaded) return;
    const oldestMessage = [...olderRows].reverse().find((row) => row.kind !== 7);
    const generation = ++boundaryLoadGenerationRef.current;
    if (!oldestMessage) {
      startTransition(() => setAnchorOlderBoundary(null));
      return;
    }
    const cachedBoundary = activeAnchorWindow.olderPrefetch.find(
      (row) => row.kind !== 7,
    );
    if (cachedBoundary) {
      startTransition(() => setAnchorOlderBoundary({
        createdAt: cachedBoundary.createdAt,
        senderPubkey: cachedBoundary.senderPubkey,
      }));
      return;
    }
    void readOlderMessageBoundary(oldestMessage).then((createdAt) => {
      if (boundaryLoadGenerationRef.current !== generation) return;
      startTransition(() => setAnchorOlderBoundary(createdAt));
    }).catch(() => {});
  }, [
    activeAnchorWindow?.loaded,
    activeAnchorWindow?.olderPrefetch,
    anchor,
    olderRows,
    readOlderMessageBoundary,
  ]);

  useEffect(() => {
    if (liveDataEnabled) return;
    tailLoadGenerationRef.current += 1;
    boundaryLoadGenerationRef.current += 1;
    tailGapGenerationRef.current += 1;
    tailLoadingRef.current = false;
    tailPrefetchingRef.current = false;
    tailRevealAfterPrefetchRef.current = false;
    startTransition(() => {
      setTailLoadingOlder(false);
    });
  }, [liveDataEnabled]);

  useEffect(
    () => () => {
      tailLoadGenerationRef.current += 1;
      tailLoadingRef.current = false;
      tailPrefetchingRef.current = false;
      tailRevealAfterPrefetchRef.current = false;
      boundaryLoadGenerationRef.current += 1;
      tailGapGenerationRef.current += 1;
    },
    [],
  );

  const ascending = useMemo(() => {
    if (!anchor) {
      return tailWindow.prepared?.rowsNewestFirst === tailRows && tailHistory.length === 0
        ? tailWindow.prepared.rowsAscending
        : [...tailNewestFirst].reverse();
    }
    return [...olderRows].reverse().concat(newerRows);
  }, [anchor, tailHistory.length, tailNewestFirst, tailRows, tailWindow.prepared, olderRows, newerRows]);
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
    [anchor, ascending, proximity, selfPubkey, tailWindow.prepared],
  );
  // Only the navigation-warmed tail is prepared eagerly. Historical batches
  // stay raw until FlatList actually mounts a cell; `prepareMessagePresentation`
  // owns a bounded id cache, so revisiting a mounted row remains cheap without
  // parsing all 60 newly inserted messages in the insertion commit.
  const presentationsByMessageId =
    tailWindow.prepared?.presentationsByMessageId ?? EMPTY_PRESENTATIONS;
  const bubbleRenderItemsById =
    tailWindow.prepared?.bubbleRenderItemsById ?? EMPTY_RENDER_ITEMS;

  const hasMore = anchor
    ? (activeAnchorWindow?.olderPrefetch.length ?? 0) > 0 ||
      !!activeAnchorWindow?.olderHasMore
    : tailOlderPrefetch.length > 0 || tailHasMore;
  const hasMoreNewer = anchor
    ? (activeAnchorWindow?.newerPrefetch.length ?? 0) > 0 ||
      !!activeAnchorWindow?.newerHasMore
    : false;
  const tailCachedBoundary = useMemo((): MessageBoundary | undefined => {
    const cached = tailOlderPrefetch.find((row) => row.kind !== 7);
    return cached
      ? { createdAt: cached.createdAt, senderPubkey: cached.senderPubkey }
      : undefined;
  }, [tailOlderPrefetch]);
  const anchorCachedBoundary = useMemo((): MessageBoundary | undefined => {
    const cached = activeAnchorWindow?.olderPrefetch.find((row) => row.kind !== 7);
    return cached
      ? { createdAt: cached.createdAt, senderPubkey: cached.senderPubkey }
      : undefined;
  }, [activeAnchorWindow?.olderPrefetch]);
  const oldestBoundary = anchor
    ? anchorCachedBoundary ?? anchorOlderBoundary
    : tailCachedBoundary ?? tailOlderBoundary;
  // Anchored mode needs both sides in before a jump positions, so the target's
  // index is final. Readiness is keyed because live-query state survives deps.
  const windowLoaded = anchor ? !!activeAnchorWindow?.loaded : tailReady;

  const requestAnchorHistory = useCallback((
    side: 'older' | 'newer',
    revealOnArrival: boolean,
  ) => {
    if (!anchorKey || !liveDataEnabled) return;
    const current = anchorWindowsRef.current.get(anchorKey);
    if (!current?.loaded) return;
    const requestKey = side === 'older'
      ? 'olderRequestInFlight'
      : 'newerRequestInFlight';
    const revealKey = side === 'older'
      ? 'revealOlderOnArrival'
      : 'revealNewerOnArrival';
    const hasMoreKey = side === 'older' ? 'olderHasMore' : 'newerHasMore';
    const failedKey = side === 'older' ? 'olderPrefetchFailed' : 'newerPrefetchFailed';
    const rowsKey = side === 'older' ? 'olderRows' : 'newerRows';
    const prefetchKey = side === 'older' ? 'olderPrefetch' : 'newerPrefetch';

    if (current[requestKey]) {
      if (revealOnArrival && !current[revealKey]) {
        updateAnchorWindow(anchorKey, (window) => ({
          ...window!,
          [revealKey]: true,
        }));
      }
      return;
    }
    if (!current[hasMoreKey]) return;
    const cursorRows = current[prefetchKey];
    const visibleRows = current[rowsKey];
    const cursor = cursorRows[cursorRows.length - 1] ?? visibleRows[visibleRows.length - 1];
    if (!cursor) return;

    updateAnchorWindow(anchorKey, (window) => ({
      ...window!,
      [requestKey]: true,
      [revealKey]: revealOnArrival,
      [failedKey]: false,
    }));
    const startedAt = chatPerformanceNow();
    const cursorCondition = side === 'older'
      ? or(
          lt(messages.orderAt, cursor.orderAt),
          and(eq(messages.orderAt, cursor.orderAt), gt(messages.id, cursor.id)),
        )
      : or(
          gt(messages.orderAt, cursor.orderAt),
          and(eq(messages.orderAt, cursor.orderAt), lt(messages.id, cursor.id)),
        );
    void db
      .select()
      .from(messages)
      .where(and(base, cursorCondition))
      .orderBy(
        side === 'older' ? desc(messages.orderAt) : asc(messages.orderAt),
        side === 'older' ? asc(messages.id) : desc(messages.id),
      )
      .limit(MESSAGE_HISTORY_FETCH_SIZE + 1)
      .then((result) => {
        const page = result.slice(0, MESSAGE_HISTORY_FETCH_SIZE);
        const latest = anchorWindowsRef.current.get(anchorKey);
        if (!latest) return;
        const currentPrefetch = latest[prefetchKey];
        const expanded = side === 'older'
          ? mergeNewestFirstRows(currentPrefetch, page)
          : mergeNewestFirstRows(
              [...currentPrefetch].reverse(),
              [...page].reverse(),
            ).reverse();
        const shouldReveal = latest[revealKey];
        const revealed = shouldReveal
          ? expanded.slice(0, MESSAGE_HISTORY_APPEND_SIZE)
          : [];
        const prefetched = shouldReveal
          ? expanded.slice(revealed.length)
          : expanded;
        updateAnchorWindow(anchorKey, (window) => ({
          ...window!,
          [rowsKey]: side === 'older'
            ? mergeNewestFirstRows(window![rowsKey], revealed)
            : mergeNewestFirstRows(
                [...window![rowsKey]].reverse(),
                [...revealed].reverse(),
              ).reverse(),
          [prefetchKey]: prefetched,
          [hasMoreKey]: result.length > MESSAGE_HISTORY_FETCH_SIZE,
          [requestKey]: false,
          [revealKey]: false,
          [failedKey]: false,
        }));
        logChatPerformance('anchor.history.query', {
          elapsedMs: Math.round(chatPerformanceNow() - startedAt),
          fetchedRows: page.length,
          newer: side === 'newer',
        });
      })
      .catch(() => {
        updateAnchorWindow(anchorKey, (window) => ({
          ...window!,
          [requestKey]: false,
          [revealKey]: false,
          [failedKey]: true,
        }));
      });
  }, [anchorKey, base, liveDataEnabled, updateAnchorWindow]);

  useEffect(() => {
    if (!anchorKey || !activeAnchorWindow?.loaded) return;
    if (
      activeAnchorWindow.olderHasMore &&
      !activeAnchorWindow.olderPrefetchFailed &&
      activeAnchorWindow.olderPrefetch.length <= MESSAGE_HISTORY_PREFETCH_THRESHOLD
    ) {
      requestAnchorHistory('older', false);
    }
    if (
      activeAnchorWindow.newerHasMore &&
      !activeAnchorWindow.newerPrefetchFailed &&
      activeAnchorWindow.newerPrefetch.length <= MESSAGE_HISTORY_PREFETCH_THRESHOLD
    ) {
      requestAnchorHistory('newer', false);
    }
  }, [activeAnchorWindow, anchorKey, requestAnchorHistory]);

  const prefetchTailHistory = useCallback((revealOnArrival: boolean) => {
    if (anchor || !liveDataEnabled) return;
    if (revealOnArrival) {
      tailRevealAfterPrefetchRef.current = true;
      tailLoadingRef.current = true;
      setTailLoadingOlder(true);
    }
    if (tailPrefetchingRef.current || !tailHasMore) return;

    const cachedRows = tailOlderPrefetchRef.current;
    const loadedRows = tailLoadedNewestFirstRef.current;
    const cursor = cachedRows[cachedRows.length - 1] ?? loadedRows[loadedRows.length - 1];
    if (!cursor) {
      tailRevealAfterPrefetchRef.current = false;
      tailLoadingRef.current = false;
      setTailLoadingOlder(false);
      return;
    }

    tailPrefetchingRef.current = true;
    boundaryLoadGenerationRef.current += 1;
    const generation = ++tailLoadGenerationRef.current;
    const startedAt = chatPerformanceNow();
    logChatPerformance('history.request', {
      retainedRows: loadedRows.length,
      cachedRows: cachedRows.length,
      prefetch: !revealOnArrival,
    });
    const cursorCondition = or(
      lt(messages.orderAt, cursor.orderAt),
      and(eq(messages.orderAt, cursor.orderAt), gt(messages.id, cursor.id)),
    );
    void db
      .select()
      .from(messages)
      .where(and(base, cursorCondition))
      .orderBy(desc(messages.orderAt), asc(messages.id))
      .limit(MESSAGE_HISTORY_FETCH_SIZE + 1)
      .then((rows) => {
        if (tailLoadGenerationRef.current !== generation) return;
        logChatPerformance('history.query', {
          elapsedMs: Math.round(chatPerformanceNow() - startedAt),
          fetchedRows: rows.length,
          prefetch: !revealOnArrival,
        });
        const page = rows.slice(0, MESSAGE_HISTORY_FETCH_SIZE);
        const expanded = mergeNewestFirstRows(tailOlderPrefetchRef.current, page);
        const shouldReveal = tailRevealAfterPrefetchRef.current;
        const revealed = shouldReveal
          ? expanded.slice(0, MESSAGE_HISTORY_APPEND_SIZE)
          : [];
        const prefetched = shouldReveal ? expanded.slice(revealed.length) : expanded;
        pendingPageTrace.current = { startedAt, rows: page.length };
        logChatPerformance('history.prepared', {
          elapsedMs: Math.round(chatPerformanceNow() - startedAt),
          fetchedRows: page.length,
          cachedRows: prefetched.length,
        });
        tailPageCommitPendingRef.current = true;
        tailOlderPrefetchRef.current = prefetched;
        startTransition(() => {
          if (revealed.length > 0) {
            setTailHistory((current) => mergeNewestFirstRows(current, revealed));
          }
          setTailOlderPrefetch(prefetched);
          setTailHasMore(rows.length > MESSAGE_HISTORY_FETCH_SIZE);
        });
      })
      .catch(() => {
        logChatPerformance('history.failed', {
          elapsedMs: Math.round(chatPerformanceNow() - startedAt),
        });
      })
      .finally(() => {
        if (tailLoadGenerationRef.current !== generation) return;
        tailPrefetchingRef.current = false;
        tailRevealAfterPrefetchRef.current = false;
        tailLoadingRef.current = false;
        startTransition(() => setTailLoadingOlder(false));
      });
  }, [anchor, base, liveDataEnabled, tailHasMore]);

  useEffect(() => {
    if (
      anchor ||
      !tailReady ||
      !tailHasMore ||
      (tailHistory.length === 0 &&
        tailOlderPrefetch.length === 0 &&
        tail.data.length > MESSAGES_PAGE_SIZE) ||
      tailOlderPrefetch.length > MESSAGE_HISTORY_PREFETCH_THRESHOLD
    ) {
      return;
    }
    prefetchTailHistory(false);
  }, [
    anchor,
    prefetchTailHistory,
    tailHasMore,
    tailHistory.length,
    tail.data.length,
    tailOlderPrefetch.length,
    tailReady,
  ]);

  const loadOlder = useCallback(() => {
    if (anchorKey) {
      const window = anchorWindowsRef.current.get(anchorKey);
      if (!window?.loaded) return;
      if (window.olderPrefetch.length > 0) {
        const revealed = window.olderPrefetch.slice(0, MESSAGE_HISTORY_APPEND_SIZE);
        updateAnchorWindow(anchorKey, (current) => ({
          ...current!,
          olderRows: mergeNewestFirstRows(current!.olderRows, revealed),
          olderPrefetch: current!.olderPrefetch.slice(revealed.length),
        }));
      } else if (window.olderHasMore) {
        requestAnchorHistory('older', true);
      }
      return;
    }
    if (tailPageCommitPendingRef.current) return;
    const cachedRows = tailOlderPrefetchRef.current;
    if (cachedRows.length > 0) {
      const revealed = cachedRows.slice(0, MESSAGE_HISTORY_APPEND_SIZE);
      const remaining = cachedRows.slice(revealed.length);
      tailPageCommitPendingRef.current = true;
      tailOlderPrefetchRef.current = remaining;
      startTransition(() => {
        setTailHistory((current) => mergeNewestFirstRows(current, revealed));
        setTailOlderPrefetch(remaining);
      });
      return;
    }
    if (!tailHasMore) return;
    prefetchTailHistory(true);
  }, [anchorKey, prefetchTailHistory, requestAnchorHistory, tailHasMore, updateAnchorWindow]);

  const loadNewer = useCallback(() => {
    if (anchorKey) {
      const window = anchorWindowsRef.current.get(anchorKey);
      if (!window?.loaded) return;
      if (window.newerPrefetch.length > 0) {
        const revealed = window.newerPrefetch.slice(0, MESSAGE_HISTORY_APPEND_SIZE);
        updateAnchorWindow(anchorKey, (current) => ({
          ...current!,
          newerRows: mergeNewestFirstRows(
            [...current!.newerRows].reverse(),
            [...revealed].reverse(),
          ).reverse(),
          newerPrefetch: current!.newerPrefetch.slice(revealed.length),
        }));
      } else if (window.newerHasMore) {
        requestAnchorHistory('newer', true);
      }
      return;
    }
  }, [anchorKey, requestAnchorHistory, updateAnchorWindow]);

  const focusAnchor = useCallback((a: MessageAnchor) => {
    tailLoadGenerationRef.current += 1;
    tailLoadingRef.current = false;
    tailPrefetchingRef.current = false;
    tailRevealAfterPrefetchRef.current = false;
    tailPageCommitPendingRef.current = false;
    boundaryLoadGenerationRef.current += 1;
    setTailLoadingOlder(false);
    setAnchorOlderBoundary(undefined);
    setAnchor(a);
  }, []);

  const jumpToTail = useCallback(() => {
    tailLoadGenerationRef.current += 1;
    tailLoadingRef.current = false;
    tailPrefetchingRef.current = false;
    tailRevealAfterPrefetchRef.current = false;
    tailPageCommitPendingRef.current = false;
    boundaryLoadGenerationRef.current += 1;
    setTailLoadingOlder(false);
    // A focused jump disabled the tail query, so force a fresh read. Ordinary
    // history browsing keeps the live tail subscribed and its snapshot warm.
    // Keep every tail page and prefetched row owned by this mounted chat so
    // returning from the anchor never has to rebuild already-read history.
    if (anchor) invalidateWarmedMessageTail(accountPubkey, conversationKey);
    setAnchor(null);
    previousTailRowsRef.current = [];
    // The tail query was disabled while anchored. Force readiness to
    // belong to its new activation instead of reusing the anchored-era result.
    setTailEpoch((epoch) => epoch + 1);
  }, [accountPubkey, anchor, conversationKey]);

  return {
    messages: ascending,
    bubbleMessages,
    reactionsByMessageId,
    presentationsByMessageId,
    bubbleRenderItemsById,
    loadOlder,
    loadNewer,
    hasMore,
    loadingOlder: anchor
      ? !!activeAnchorWindow?.olderRequestInFlight &&
        activeAnchorWindow.revealOlderOnArrival
      : tailLoadingOlder,
    loadingNewer: anchor
      ? !!activeAnchorWindow?.newerRequestInFlight &&
        activeAnchorWindow.revealNewerOnArrival
      : false,
    hasMoreNewer,
    oldestBoundary,
    tailJumpVersion: tailEpoch,
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
  sessionKey = '',
): Record<string, MessageRow> {
  const [cacheState, setCacheState] = useState(() => ({
    sessionKey,
    messages: {} as Record<string, MessageRow>,
  }));
  if (cacheState.sessionKey !== sessionKey) {
    setCacheState({ sessionKey, messages: {} });
  }
  // inArray([]) is unsafe; use a never-matching sentinel id when empty.
  const safeIds = ids.length > 0 ? ids : [' '];
  const queryEnabled = liveDataEnabled && ids.length > 0;
  const { data, isResolved } = useLiveQuery(
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

  const currentMessages = useMemo(() => {
    if (!isResolved) return null;
    const map: Record<string, MessageRow> = {};
    for (const row of data ?? []) map[row.id] = row;
    return map;
  }, [data, isResolved]);
  const mergedMessages = useMemo(() => {
    if (!currentMessages) return cacheState.messages;
    const merged = { ...cacheState.messages };
    for (const id of ids) delete merged[id];
    return Object.assign(merged, currentMessages);
  }, [cacheState.messages, currentMessages, ids]);
  useEffect(() => {
    if (!currentMessages) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCacheState((current) => {
      if (current.sessionKey !== sessionKey) return current;
      const cached = { ...current.messages };
      for (const id of ids) delete cached[id];
      Object.assign(cached, currentMessages);
      return { ...current, messages: cached };
    });
  }, [currentMessages, ids, sessionKey]);
  return mergedMessages;
}
