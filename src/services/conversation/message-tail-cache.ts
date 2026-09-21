import type { messages } from '@/db/schema';
import {
  prepareMessagePresentation,
  type PreparedMessagePresentation,
} from '@/lib/chat/message-presentation';
import { MESSAGES_PAGE_SIZE } from '@/lib/message-window';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';
import {
  aggregateReactionsByTarget,
  type ReactionAggregate,
} from '@/lib/nostr/reactions';
import { isDifferentDay } from '@/lib/time';
import { platform } from '@/platform';

type MessageRow = typeof messages.$inferSelect;

type RawMessageRow = {
  account_pubkey: string;
  id: string;
  conversation_key: string;
  sender_pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  order_at: number;
  reply_to_id: string | null;
  subject: string | null;
  tags: string;
  rumor: string;
  delivery_status: MessageRow['deliveryStatus'];
  source_relays: string | null;
};

type InFlightWarm = {
  generation: number;
  promise: Promise<void>;
};

type WarmRequest = {
  accountPubkey: string;
  conversationKey: string;
};

export type PreparedMessageTail = {
  /** SQLite/query order, newest first. */
  rowsNewestFirst: MessageRow[];
  /** FlatList source order before inversion, oldest first. */
  rowsAscending: MessageRow[];
  /** Bubble rows only; kind-7 reactions have already been removed. */
  messagesAscending: MessageRow[];
  /** Stable render models keyed by the immutable Nostr message id. */
  presentationsByMessageId: Record<string, PreparedMessagePresentation>;
  /** Account-scoped aggregation prepared while the inbox is idle. */
  reactionsByMessageId: Record<string, ReactionAggregate[]>;
  /** Invariant row relationships prepared before the first chat render. */
  bubbleRenderItemsById: Record<string, PreparedBubbleRenderItem>;
};

export type PreparedBubbleRenderItem = {
  message: MessageRow;
  presentation: PreparedMessagePresentation;
  reactions: ReactionAggregate[];
  /** The older neighbouring bubble used to validate grouping/date metadata if
   * paging later extends the window. */
  olderMessageId: string | null;
  groupStart: boolean;
  showDate: boolean;
  /** Reply target when it is already inside this bounded message window. */
  replyTarget: MessageRow | null;
};

type TailCacheEntry = {
  accountPubkey: string;
  prepared: PreparedMessageTail;
  /** Nearby messages use a transport identity instead of the account pubkey.
   * Build that rare variant once, then retain it with the same snapshot. */
  reactionsBySelfPubkey: Map<string, Record<string, ReactionAggregate[]>>;
};

const MAX_WARM_TAILS = 32;
const cache = new Map<string, TailCacheEntry>();
const generations = new Map<string, number>();
const inFlight = new Map<string, InFlightWarm>();
const queue = new Map<string, WarmRequest>();
let queueRunning = false;

function cacheKey(accountPubkey: string, conversationKey: string): string {
  return `${accountPubkey}\u0000${conversationKey}`;
}

function generationFor(key: string): number {
  return generations.get(key) ?? 0;
}

function advanceGeneration(key: string): number {
  const next = generationFor(key) + 1;
  generations.set(key, next);
  return next;
}

function decodeRow(row: RawMessageRow): MessageRow {
  return {
    accountPubkey: row.account_pubkey,
    id: row.id,
    conversationKey: row.conversation_key,
    senderPubkey: row.sender_pubkey,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
    orderAt: row.order_at,
    replyToId: row.reply_to_id,
    subject: row.subject,
    tags: JSON.parse(row.tags) as MessageRow['tags'],
    rumor: JSON.parse(row.rumor) as MessageRow['rumor'],
    deliveryStatus: row.delivery_status,
    sourceRelays: row.source_relays
      ? (JSON.parse(row.source_relays) as MessageRow['sourceRelays'])
      : null,
  };
}

function prepareTail(
  accountPubkey: string,
  rowsNewestFirst: MessageRow[],
): PreparedMessageTail {
  const rowsAscending = [...rowsNewestFirst].reverse();
  const presentationsByMessageId: Record<string, PreparedMessagePresentation> =
    {};
  for (const row of rowsAscending) {
    if (row.kind === 7) continue;
    presentationsByMessageId[row.id] = prepareMessagePresentation({
      messageId: row.id,
      kind: row.kind,
      content: row.content,
      tags: row.tags,
    });
  }
  const messagesAscending = rowsAscending.filter((row) => row.kind !== 7);
  const reactionsByMessageId = aggregateReactionsByTarget(
    rowsAscending,
    accountPubkey,
  );
  return {
    rowsNewestFirst,
    rowsAscending,
    messagesAscending,
    presentationsByMessageId,
    reactionsByMessageId,
    bubbleRenderItemsById: buildBubbleRenderItems(
      messagesAscending,
      presentationsByMessageId,
      reactionsByMessageId,
    ),
  };
}

export function buildBubbleRenderItems(
  messagesAscending: MessageRow[],
  presentationsByMessageId: Record<string, PreparedMessagePresentation>,
  reactionsByMessageId: Record<string, ReactionAggregate[]>,
): Record<string, PreparedBubbleRenderItem> {
  const messageById = new Map(
    messagesAscending.map((message) => [message.id, message] as const),
  );
  const items: Record<string, PreparedBubbleRenderItem> = {};
  for (let index = 0; index < messagesAscending.length; index += 1) {
    const message = messagesAscending[index];
    const older = index > 0 ? messagesAscending[index - 1] : null;
    const presentation =
      presentationsByMessageId[message.id] ??
      prepareMessagePresentation({
        messageId: message.id,
        kind: message.kind,
        content: message.content,
        tags: message.tags,
      });
    items[message.id] = {
      message,
      presentation,
      reactions: reactionsByMessageId[message.id] ?? [],
      olderMessageId: older?.id ?? null,
      groupStart: older == null || older.senderPubkey !== message.senderPubkey,
      showDate:
        older == null || isDifferentDay(message.createdAt, older.createdAt),
      replyTarget: message.replyToId
        ? (messageById.get(message.replyToId) ?? null)
        : null,
    };
  }
  return items;
}

function storeSnapshot(
  key: string,
  accountPubkey: string,
  rows: MessageRow[],
): void {
  // The cache is the navigation-time tail, never the screen's expanded paging
  // window. Keeping this invariant here protects every current and future writer.
  const boundedRows =
    rows.length > MESSAGES_PAGE_SIZE
      ? rows.slice(0, MESSAGES_PAGE_SIZE)
      : rows;
  const prepared = prepareTail(accountPubkey, boundedRows);
  cache.delete(key);
  cache.set(key, {
    accountPubkey,
    prepared,
    reactionsBySelfPubkey: new Map([
      [accountPubkey, prepared.reactionsByMessageId],
    ]),
  });
  if (cache.size <= MAX_WARM_TAILS) return;

  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
    if (inFlight.has(oldestKey) || queue.has(oldestKey))
      advanceGeneration(oldestKey);
    else generations.delete(oldestKey);
  }
}

/** Read the current whole-window snapshot without starting any I/O. */
export function getWarmedMessageTail(
  accountPubkey: string,
  conversationKey: string,
): MessageRow[] | null {
  if (!accountPubkey || !conversationKey) return null;
  return (
    cache.get(cacheKey(accountPubkey, conversationKey))?.prepared
      .rowsNewestFirst ?? null
  );
}

/** Read the render-ready conversation window without cloning, filtering, or
 * aggregating the warmed rows during navigation. */
export function getWarmedMessageTailPresentation(
  accountPubkey: string,
  conversationKey: string,
  selfPubkey = accountPubkey,
  proximity = false,
): PreparedMessageTail | null {
  if (!accountPubkey || !conversationKey) return null;
  const entry = cache.get(cacheKey(accountPubkey, conversationKey));
  if (!entry) return null;
  if (!proximity && (!selfPubkey || selfPubkey === entry.accountPubkey)) {
    return entry.prepared;
  }

  const reactionOwnerKey = `${proximity ? 'proximity' : 'relay'}:${selfPubkey}`;
  let reactionsByMessageId = entry.reactionsBySelfPubkey.get(reactionOwnerKey);
  if (!reactionsByMessageId) {
    reactionsByMessageId = aggregateReactionsByTarget(
      entry.prepared.rowsAscending,
      selfPubkey,
      proximity,
    );
    entry.reactionsBySelfPubkey.set(reactionOwnerKey, reactionsByMessageId);
  }
  return {
    ...entry.prepared,
    reactionsByMessageId,
    bubbleRenderItemsById: buildBubbleRenderItems(
      entry.prepared.messagesAscending,
      entry.prepared.presentationsByMessageId,
      reactionsByMessageId,
    ),
  };
}

/** Refresh the bounded cached tail from an authoritative live-query result. */
export function replaceWarmedMessageTail(
  accountPubkey: string,
  conversationKey: string,
  rows: MessageRow[],
): void {
  if (!accountPubkey || !conversationKey) return;
  const key = cacheKey(accountPubkey, conversationKey);
  advanceGeneration(key);
  storeSnapshot(key, accountPubkey, rows);
}

/** Delete the whole snapshot and make every older native read stale. */
export function invalidateWarmedMessageTail(
  accountPubkey: string,
  conversationKey: string,
): void {
  if (!accountPubkey || !conversationKey) return;
  const key = cacheKey(accountPubkey, conversationKey);
  advanceGeneration(key);
  cache.delete(key);
}

/** Rebuild one missing snapshot from SQLite. Navigation never awaits this work. */
export async function warmMessageTail(
  accountPubkey: string,
  conversationKey: string,
): Promise<void> {
  if (!accountPubkey || !conversationKey) return;
  const key = cacheKey(accountPubkey, conversationKey);
  if (cache.has(key)) return;

  const generation = generationFor(key);
  const active = inFlight.get(key);
  if (active?.generation === generation) return active.promise;

  const promise = (async () => {
    try {
      const rows = await platform.database.rawQuery<RawMessageRow>(
        `SELECT account_pubkey, id, conversation_key, sender_pubkey, kind, content,
                created_at, order_at, reply_to_id, subject, tags, rumor,
                delivery_status, source_relays
           FROM messages
          WHERE account_pubkey = ? AND conversation_key = ? AND kind IN (14, 15, 7)
          ORDER BY order_at DESC, id ASC
          LIMIT ?`,
        [accountPubkey, conversationKey, MESSAGES_PAGE_SIZE],
      );
      if (generationFor(key) !== generation) return;
      storeSnapshot(key, accountPubkey, rows.map(decodeRow));
    } catch {
      // Database startup can briefly race a warm-up; the live query still loads it.
    }
  })();

  inFlight.set(key, { generation, promise });
  try {
    await promise;
  } finally {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  }
}

/** Queue one whole-window rebuild. Work is serialized with a macrotask yield. */
export function scheduleMessageTailWarm(
  accountPubkey: string,
  conversationKey: string,
): void {
  if (!accountPubkey || !conversationKey) return;
  const key = cacheKey(accountPubkey, conversationKey);
  if (cache.has(key) || queue.has(key)) return;
  const active = inFlight.get(key);
  if (active?.generation === generationFor(key)) return;

  queue.set(key, { accountPubkey, conversationKey });
  if (queueRunning) return;
  queueRunning = true;
  setTimeout(drainQueue, 0);
}

/**
 * Merge one just-stored message into the cached window in place: ordered insert
 * with id dedupe, trimmed to the window, snapshot rebuilt from memory. The write
 * path already holds every column, so this replaces an invalidate + queued DB
 * re-read — which also opened a cold-paint gap for the next tap. No-op without a
 * cached entry; the warm queue / live query covers those conversations.
 */
export function mergeStoredMessageIntoTail(accountPubkey: string, row: MessageRow): void {
  // Keep the cached window's contract: the warm query selects kinds 14/15/7.
  if (!accountPubkey || !row.conversationKey) return;
  if (row.kind !== 14 && row.kind !== 15 && row.kind !== 7) return;
  const key = cacheKey(accountPubkey, row.conversationKey);
  const entry = cache.get(key);
  if (!entry) {
    // A warm read started before this write committed may resolve with a
    // snapshot missing this message — discard it and re-read.
    if (inFlight.has(key)) {
      advanceGeneration(key);
      scheduleMessageTailWarm(accountPubkey, row.conversationKey);
    }
    return;
  }

  // Discard the result of any warm read started before this write.
  advanceGeneration(key);

  const rows = entry.prepared.rowsNewestFirst;
  if (rows.some((existing) => existing.id === row.id)) return;

  // Window order matches the SQLite query: order_at DESC, id ASC.
  const comesBefore = (a: MessageRow, b: MessageRow): boolean =>
    isMessageOrderNewer(a, b);

  // A row older than the whole window cannot enter it — the common case once a
  // history backfill moves past the cached newest page.
  const oldest = rows[rows.length - 1];
  if (rows.length >= MESSAGES_PAGE_SIZE && oldest && !comesBefore(row, oldest)) return;

  let insertAt = rows.length;
  for (let index = 0; index < rows.length; index += 1) {
    if (comesBefore(row, rows[index])) {
      insertAt = index;
      break;
    }
  }
  const merged = [...rows.slice(0, insertAt), row, ...rows.slice(insertAt)];
  if (merged.length > MESSAGES_PAGE_SIZE) merged.length = MESSAGES_PAGE_SIZE;

  storeSnapshot(key, accountPubkey, merged);
}

function drainQueue(): void {
  const next = queue.entries().next().value as
    [string, WarmRequest] | undefined;
  if (!next) {
    queueRunning = false;
    return;
  }

  const [key, request] = next;
  queue.delete(key);
  void warmMessageTail(request.accountPubkey, request.conversationKey).finally(
    () => {
      setTimeout(drainQueue, 0);
    },
  );
}
