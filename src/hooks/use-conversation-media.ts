import { and, asc, desc, eq, gt, lt, lte, or, sql } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useCallback, useMemo, useState } from 'react';

import { db } from '@/db/client';
import { messageMedia, messages, type MessageMediaSource } from '@/db/schema';
import { embeddedMediaByUrl, type EmbeddedMedia } from '@/lib/nostr/embedded-media';
import { findFileMeta, type FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { parseMessageSegments } from '@/lib/text/message-segments';

type ConversationMediaBase = {
  /** Stable row identity; a message may carry several media URLs. */
  mediaKey: string;
  messageId: string;
  createdAt: number;
  orderAt: number;
  isVideo: boolean;
};

/** One viewable image/video, encrypted attachment or direct media URL. */
export type ConversationMediaItem =
  | (ConversationMediaBase & { source: 'attachment'; meta: FileAttachmentMeta })
  | (ConversationMediaBase & { source: 'embedded'; meta: EmbeddedMedia });

/** Centre the media window on a specific item (opened from a chat bubble / a grid
 * cell deep in history). */
export type MediaAnchor = { orderAt: number; messageId: string; url: string };

export type PaginatedMedia = {
  /** Loaded window, oldest-first (ascending) — ready for the inverted list. */
  items: ConversationMediaItem[];
  /** Grow the window by one page of OLDER media. */
  loadOlder: () => void;
  /** Grow the window by one page of NEWER media (anchored mode only). */
  loadNewer: () => void;
  /** True while older media may still exist. */
  hasMore: boolean;
  /** True while newer media exist between the window and the live tail. */
  hasMoreNewer: boolean;
  /** True when the window is centred on an anchor (not following the tail). */
  anchored: boolean;
  /** False until the active query has resolved once (gate the empty state). */
  loaded: boolean;
};

/** Gallery rows per page. The indexed query already excludes audio and files. */
export const MEDIA_PAGE_SIZE = 60;

/** Image and video are the gallery-viewable kinds; audio/file are excluded. */
function isViewable(mime: string | undefined): boolean {
  const normalized = mime?.trim().toLowerCase();
  return (
    !!normalized &&
    (normalized.startsWith('image/') || normalized.startsWith('video/'))
  );
}

type Row = {
  id: string;
  source: MessageMediaSource;
  url: string;
  content: string;
  tags: string[][];
  createdAt: number;
  orderAt: number;
};

function toItem(row: Row): ConversationMediaItem | null {
  if (row.source === 'attachment') {
    const meta = findFileMeta(row.content, row.tags);
    if (!meta || !isViewable(meta.mime)) return null;
    return {
      source: 'attachment',
      mediaKey: `${row.id}\u0000${row.url}`,
      messageId: row.id,
      createdAt: row.createdAt,
      orderAt: row.orderAt,
      meta,
      isVideo: !!meta.mime?.trim().toLowerCase().startsWith('video/'),
    };
  }

  const urls = parseMessageSegments(row.content).flatMap((segment) =>
    segment.type === 'url' ? [segment.href] : [],
  );
  const meta = embeddedMediaByUrl(urls, row.tags).get(row.url);
  if (!meta || (meta.kind !== 'image' && meta.kind !== 'video')) return null;
  return {
    source: 'embedded',
    mediaKey: `${row.id}\u0000${row.url}`,
    messageId: row.id,
    createdAt: row.createdAt,
    orderAt: row.orderAt,
    meta,
    isVideo: meta.kind === 'video',
  };
}

/**
 * Windowed live query of a conversation's indexed images/videos — the data
 * behind the media gallery (album + swipe pager). Mirrors {@link useMessages}:
 *
 * - **Tail** (no anchor): the newest page, grown older-ward — the album opened
 *   fresh from the profile sits here (newest at the bottom of the inverted list).
 * - **Anchored** (anchor set): a bounded page on each side of a target item,
 *   grown independently both ways. Opening the gallery from an image deep in a
 *   1M-message history loads ~two pages around it, **never** the whole history.
 *
 * Driven off the **`message_media`
 * `(account_pubkey, conversation_key, gallery, order_at, message_id, url)`** index, joined
 * to `messages` only for the rumor `content`/`tags` — so it never scans the
 * conversation's text messages, and the index covers both filter and order.
 * Kind-15 rows use their declared `file-type`; kind-14 rows run the same direct-
 * media parser as the message bubble. All three queries are always subscribed
 * (hooks can't be conditional); inactive ones are neutered to `LIMIT 0`. When
 * disabled for native viewer entrance, all queries return no rows and parsing
 * waits until the transition completes.
 */
export function useConversationMedia(
  accountPubkey: string,
  conversationKey: string,
  anchor?: MediaAnchor | null,
  enabled = true,
): PaginatedMedia {
  const [limit, setLimit] = useState(MEDIA_PAGE_SIZE);
  const [olderCount, setOlderCount] = useState(MEDIA_PAGE_SIZE);
  const [newerCount, setNewerCount] = useState(MEDIA_PAGE_SIZE);

  // Reset paging when the conversation or the anchor changes — during render
  // (adjust-state-on-prop-change) so it lands before paint, like useMessages.
  const anchorKey = anchor ? `${anchor.orderAt}:${anchor.messageId}:${anchor.url}` : '';
  const [prevKey, setPrevKey] = useState(`${conversationKey}|${anchorKey}`);
  const key = `${conversationKey}|${anchorKey}`;
  if (prevKey !== key) {
    setPrevKey(key);
    setLimit(MEDIA_PAGE_SIZE);
    setOlderCount(MEDIA_PAGE_SIZE);
    setNewerCount(MEDIA_PAGE_SIZE);
  }

  const cols = {
    id: messages.id,
    source: messageMedia.source,
    url: messageMedia.url,
    content: messages.content,
    tags: messages.tags,
    createdAt: messageMedia.createdAt,
    orderAt: messageMedia.orderAt,
  };
  const base = and(
    eq(messageMedia.accountPubkey, accountPubkey),
    eq(messageMedia.conversationKey, conversationKey),
    eq(messageMedia.gallery, true),
  );
  const join = () =>
    db
      .select(cols)
      .from(messageMedia)
      .innerJoin(
        messages,
        and(
          eq(messages.accountPubkey, messageMedia.accountPubkey),
          eq(messages.id, messageMedia.messageId),
        ),
      );

  const tailLimit = enabled && !anchor ? limit : 0;
  const olderLimit = enabled && anchor ? olderCount : 0;
  const newerLimit = enabled && anchor ? newerCount : 0;

  // Tail: newest N attachment rows, oldest-ward. Neutered while anchored.
  const tail = useLiveQuery(
    join()
      .where(base)
      .orderBy(
        desc(messageMedia.orderAt),
        asc(messageMedia.messageId),
        desc(messageMedia.url),
      )
      .limit(tailLimit),
    [accountPubkey, conversationKey, tailLimit],
  );

  // Older side of the anchor (inclusive of the anchor itself), newest-first.
  const olderCond = anchor
    ? or(
        lt(messageMedia.orderAt, anchor.orderAt),
        and(
          eq(messageMedia.orderAt, anchor.orderAt),
          or(
            gt(messageMedia.messageId, anchor.messageId),
            and(
              eq(messageMedia.messageId, anchor.messageId),
              lte(messageMedia.url, anchor.url),
            ),
          ),
        ),
      )
    : sql`0`;
  const older = useLiveQuery(
    join()
      .where(and(base, olderCond))
      .orderBy(
        desc(messageMedia.orderAt),
        asc(messageMedia.messageId),
        desc(messageMedia.url),
      )
      .limit(olderLimit),
    [accountPubkey, conversationKey, anchorKey, olderLimit],
  );

  // Newer side of the anchor (exclusive), oldest-first.
  const newerCond = anchor
    ? or(
        gt(messageMedia.orderAt, anchor.orderAt),
        and(
          eq(messageMedia.orderAt, anchor.orderAt),
          or(
            lt(messageMedia.messageId, anchor.messageId),
            and(
              eq(messageMedia.messageId, anchor.messageId),
              gt(messageMedia.url, anchor.url),
            ),
          ),
        ),
      )
    : sql`0`;
  const newer = useLiveQuery(
    join()
      .where(and(base, newerCond))
      .orderBy(
        asc(messageMedia.orderAt),
        desc(messageMedia.messageId),
        asc(messageMedia.url),
      )
      .limit(newerLimit),
    [accountPubkey, conversationKey, anchorKey, newerLimit],
  );

  // Build the ascending media window. No overlap to dedupe: older is anchor-
  // inclusive, newer anchor-exclusive.
  const items = useMemo<ConversationMediaItem[]>(() => {
    if (!enabled) return [];
    const tailRows = (tail.data ?? []) as Row[];
    const olderRows = (older.data ?? []) as Row[];
    const newerRows = (newer.data ?? []) as Row[];
    const ascendingRows = anchor
      ? [...olderRows].reverse().concat(newerRows)
      : [...tailRows].reverse();
    const out: ConversationMediaItem[] = [];
    for (const row of ascendingRows) {
      const item = toItem(row);
      if (item) out.push(item);
    }
    return out;
  }, [enabled, anchor, tail.data, older.data, newer.data]);

  // Page counts exactly match gallery rows because the SQL filter excludes
  // audio and files before applying LIMIT.
  const tailLen = tail.data?.length ?? 0;
  const olderLen = older.data?.length ?? 0;
  const newerLen = newer.data?.length ?? 0;
  const hasMore = anchor ? olderLen >= olderCount : tailLen >= limit;
  const hasMoreNewer = anchor ? newerLen >= newerCount : false;

  const loadOlder = useCallback(() => {
    if (anchor) setOlderCount((cnt) => (olderLen >= cnt ? cnt + MEDIA_PAGE_SIZE : cnt));
    else setLimit((l) => (tailLen >= l ? l + MEDIA_PAGE_SIZE : l));
  }, [anchor, olderLen, tailLen]);

  const loadNewer = useCallback(() => {
    if (anchor) setNewerCount((cnt) => (newerLen >= cnt ? cnt + MEDIA_PAGE_SIZE : cnt));
  }, [anchor, newerLen]);

  const loaded = enabled && (anchor
    ? older.updatedAt !== undefined || newer.updatedAt !== undefined
    : tail.updatedAt !== undefined);

  return { items, loadOlder, loadNewer, hasMore, hasMoreNewer, anchored: !!anchor, loaded };
}
