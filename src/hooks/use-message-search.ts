import { useCallback, useEffect, useRef, useState } from 'react';

import { platform } from '@/platform';

/** Sentinels wrapping the matched run inside a result's `snippet`. The UI splits
 * on these to bold the hit. Control chars (STX/ETX) that can't occur in message
 * text; the FTS `snippet()` call emits the same via `char(2)`/`char(3)`. */
export const SNIPPET_OPEN = String.fromCharCode(2);
export const SNIPPET_CLOSE = String.fromCharCode(3);

export type MessageSearchHit = {
  id: string;
  conversationKey: string;
  senderPubkey: string;
  createdAt: number;
  orderAt: number;
  /** Excerpt around the match, with the hit wrapped in SNIPPET_OPEN/CLOSE. */
  snippet: string;
};

export type MessageSearchResult = {
  results: MessageSearchHit[];
  /** True while the first page (>= MIN_MESSAGE_QUERY chars) is debouncing or
   * running — lets the UI hold a quiet blank instead of flashing "no results". */
  searching: boolean;
  /** True while a `loadMore` page is being fetched. */
  loadingMore: boolean;
  /** Whether more pages may exist (the last page came back full). */
  hasMore: boolean;
  /** Fetch the next page of older matches and append them. */
  loadMore: () => void;
};

/** Below this the message index isn't searched (trigram needs >= 3 for an
 * indexed MATCH; 2 chars fall back to a bounded LIKE for CJK two-character
 * words). 1-char queries match names only. */
export const MIN_MESSAGE_QUERY = 2;

const DEBOUNCE_MS = 250;
const PAGE_SIZE = 50;
const SNIPPET_MAX_TOKENS = 64;
const SNIPPET_CONTEXT_BEFORE = 12;
const SNIPPET_CONTEXT_AFTER = 128;

/** Keyset cursor — the last hit of the current page; the next page is everything
 * strictly older by `(order_at, id)`. */
type Cursor = { orderAt: number; id: string };

type Row = {
  id: string;
  conversationKey: string;
  senderPubkey: string;
  createdAt: number;
  orderAt: number;
  content?: string;
  snippet?: string;
};

/** Wrap the raw input as a quoted FTS5 phrase so `* : - ( AND` etc. can't inject
 * query syntax — a literal substring/phrase match, which is what we want. */
function ftsPhrase(raw: string): string {
  return `"${raw.replace(/"/g, '""')}"`;
}

/** Escape LIKE wildcards so a 2-char query is matched literally. */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Build a snippet around the first (case-insensitive) match for the LIKE path,
 * where SQLite's `snippet()` (an FTS-MATCH-only function) isn't available. */
function manualSnippet(content: string, query: string): string {
  const i = content.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return content.slice(0, SNIPPET_CONTEXT_BEFORE + SNIPPET_CONTEXT_AFTER);
  const start = Math.max(0, i - SNIPPET_CONTEXT_BEFORE);
  const end = Math.min(content.length, i + query.length + SNIPPET_CONTEXT_AFTER);
  const head = start > 0 ? '…' : '';
  const tail = end < content.length ? '…' : '';
  return (
    head +
    content.slice(start, i) +
    SNIPPET_OPEN +
    content.slice(i, i + query.length) +
    SNIPPET_CLOSE +
    content.slice(i + query.length, end) +
    tail
  );
}

/** Keep the first highlighted run inside the visible portion of the one-line row
 * while retaining the wider source excerpt after it. */
function focusSnippetOnMatch(snippet: string): string {
  const hitStart = snippet.indexOf(SNIPPET_OPEN);
  if (hitStart < 0) return snippet;

  const rawPrefix = snippet.slice(0, hitStart);
  const prefix = rawPrefix.startsWith('…') ? rawPrefix.slice(1) : rawPrefix;
  const prefixChars = Array.from(prefix);
  if (prefixChars.length <= SNIPPET_CONTEXT_BEFORE) return snippet;

  return (
    `…${prefixChars.slice(-SNIPPET_CONTEXT_BEFORE).join('')}` +
    snippet.slice(hitStart)
  );
}

/**
 * Run one page of the search. `cursor` (the previous page's last hit) keyset-
 * paginates: the next page is everything strictly older. No table aliases — FTS5
 * `MATCH`/`snippet()` must name the table itself.
 */
async function runSearch(
  accountPubkey: string,
  query: string,
  conversationKey: string | undefined,
  cursor: Cursor | null,
): Promise<MessageSearchHit[]> {
  const scope = conversationKey ? 'AND message_fts.conversation_key = ?' : '';
  // Page boundary: rows strictly older than the `(order_at, id)` cursor.
  const keyset = cursor
    ? `AND (message_fts.order_at < ? OR (message_fts.order_at = ? AND message_fts.id > ?))`
    : '';
  const tail = `ORDER BY message_fts.order_at DESC, message_fts.id ASC LIMIT ${PAGE_SIZE}`;

  if (query.length >= 3) {
    // Indexed trigram MATCH + native snippet().
    const sql = `SELECT message_fts.id AS id,
        message_fts.conversation_key AS conversationKey,
        messages.sender_pubkey AS senderPubkey,
        message_fts.created_at AS createdAt,
        message_fts.order_at AS orderAt,
        snippet(message_fts, 0, char(2), char(3), '…', ${SNIPPET_MAX_TOKENS}) AS snippet
      FROM message_fts
      JOIN messages ON messages.account_pubkey = message_fts.account_pubkey AND messages.id = message_fts.id
      JOIN conversations ON conversations.account_pubkey = message_fts.account_pubkey AND conversations.conversation_key = message_fts.conversation_key
      WHERE message_fts MATCH ? AND message_fts.account_pubkey = ? AND conversations.deleted = 0 ${scope} ${keyset}
      ${tail}`;
    const params: (string | number)[] = [ftsPhrase(query), accountPubkey];
    if (conversationKey) params.push(conversationKey);
    if (cursor) params.push(cursor.orderAt, cursor.orderAt, cursor.id);
    return (await platform.database.rawQuery<Row>(sql, params)).map((r) => ({
      id: r.id,
      conversationKey: r.conversationKey,
      senderPubkey: r.senderPubkey,
      createdAt: r.createdAt,
      orderAt: r.orderAt,
      snippet: focusSnippetOnMatch(r.snippet ?? ''),
    }));
  }
  // 2-char fallback: trigram can't MATCH < 3 chars, so scan the FTS content
  // column with a bounded LIKE (covers CJK two-character words).
  const sql = `SELECT message_fts.id AS id,
      message_fts.conversation_key AS conversationKey,
      messages.sender_pubkey AS senderPubkey,
      message_fts.created_at AS createdAt, message_fts.order_at AS orderAt,
      message_fts.content AS content
    FROM message_fts
    JOIN messages ON messages.account_pubkey = message_fts.account_pubkey AND messages.id = message_fts.id
    JOIN conversations ON conversations.account_pubkey = message_fts.account_pubkey AND conversations.conversation_key = message_fts.conversation_key
    WHERE message_fts.content LIKE ? ESCAPE '\\' AND message_fts.account_pubkey = ? AND conversations.deleted = 0 ${scope} ${keyset}
    ${tail}`;
  const params: (string | number)[] = [likePattern(query), accountPubkey];
  if (conversationKey) params.push(conversationKey);
  if (cursor) params.push(cursor.orderAt, cursor.orderAt, cursor.id);
  return (await platform.database.rawQuery<Row>(sql, params)).map((r) => ({
    id: r.id,
    conversationKey: r.conversationKey,
    senderPubkey: r.senderPubkey,
    createdAt: r.createdAt,
    orderAt: r.orderAt,
    snippet: manualSnippet(r.content ?? '', query),
  }));
}

/**
 * Full-text search over message bodies (kind 14), via the `message_fts` trigram
 * index. Account- and soft-delete-scoped through a `conversations` join; pass
 * `conversationKey` to limit to a single thread (the in-conversation search).
 *
 * The first page is **debounced** and run **one-shot in a macrotask** (not a
 * live query) so a keystroke paints before the async database request; a
 * `requestId` ref drops stale results (last query wins). `loadMore` keyset-
 * paginates older matches (no OFFSET — stable under inserts, no skips/dupes).
 */
export function useMessageSearch(
  accountPubkey: string,
  query: string,
  conversationKey?: string,
): MessageSearchResult {
  const [results, setResults] = useState<MessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const reqId = useRef(0);
  // Mirror of results so `loadMore` reads the live cursor without re-subscribing.
  const resultsRef = useRef<MessageSearchHit[]>([]);
  resultsRef.current = results;

  const q = query.trim();

  useEffect(() => {
    if (!accountPubkey || q.length < MIN_MESSAGE_QUERY) {
      reqId.current++; // cancel any in-flight result
      setSearching(false);
      setLoadingMore(false);
      setHasMore(false);
      setResults([]);
      return;
    }
    setSearching(true);
    const id = ++reqId.current;
    let macro: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      // Yield once more so the debounce tick doesn't itself block a pending paint.
      macro = setTimeout(async () => {
        if (id !== reqId.current) return;
        let hits: MessageSearchHit[] = [];
        try {
          hits = await runSearch(accountPubkey, q, conversationKey, null);
        } catch {
          hits = [];
        }
        if (id !== reqId.current) return;
        setResults(hits);
        setHasMore(hits.length >= PAGE_SIZE);
        setLoadingMore(false);
        setSearching(false);
      }, 0);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      if (macro) clearTimeout(macro);
    };
  }, [accountPubkey, q, conversationKey]);

  const loadMore = useCallback(() => {
    if (q.length < MIN_MESSAGE_QUERY || !hasMore || loadingMore || searching) return;
    const last = resultsRef.current[resultsRef.current.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const id = reqId.current; // same query generation
    setTimeout(async () => {
      if (id !== reqId.current) {
        setLoadingMore(false);
        return;
      }
      let hits: MessageSearchHit[] = [];
      try {
        hits = await runSearch(accountPubkey, q, conversationKey, {
          orderAt: last.orderAt,
          id: last.id,
        });
      } catch {
        hits = [];
      }
      if (id !== reqId.current) return;
      setResults((prev) => [...prev, ...hits]);
      setHasMore(hits.length >= PAGE_SIZE);
      setLoadingMore(false);
    }, 0);
  }, [accountPubkey, q, conversationKey, hasMore, loadingMore, searching]);

  return { results, searching, loadingMore, hasMore, loadMore };
}
