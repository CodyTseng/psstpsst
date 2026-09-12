import { and, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/db/client';
import { contacts } from '@/db/schema';

type ContactRow = typeof contacts.$inferSelect;

/**
 * Session-memory contact cache. Live results seed it so revisits can show a
 * private petname immediately without a synchronous database read.
 */
const contactCache = new Map<string, ContactRow | null>();
const contactCacheKey = (accountPubkey: string, pubkey: string) =>
  `${accountPubkey}:${pubkey}`;

/** Memory-only contact lookup for the first real chat commit. Unlike
 * `warmContact`, this never touches SQLite during a navigation render. */
export function getSessionCachedContact(
  accountPubkey: string,
  pubkey: string,
): ContactRow | null {
  return contactCache.get(contactCacheKey(accountPubkey, pubkey)) ?? null;
}

/** Cache-only saved-contact state for transition-sensitive UI. `undefined`
 * means this pair has not been resolved in the current session; `false` is a
 * cached, definite non-contact. This distinction lets callers avoid briefly
 * showing stranger actions for an unknown relationship. */
export function getSessionCachedContactStatus(
  accountPubkey: string,
  pubkey: string,
): boolean | undefined {
  const key = contactCacheKey(accountPubkey, pubkey);
  if (!contactCache.has(key)) return undefined;
  return contactCache.get(key) !== null;
}

/** Cache-only warm read; database access remains asynchronous. */
function warmContact(accountPubkey: string, pubkey: string): ContactRow | null {
  const key = contactCacheKey(accountPubkey, pubkey);
  return contactCache.get(key) ?? null;
}

/**
 * Live list of the account's saved contacts, most-recently-added first.
 * `loaded` is false until the query first resolves — `data` starts as `[]`,
 * so callers must use `loaded` (not `contacts.length`) to tell "still loading"
 * from "genuinely empty" and avoid flashing an empty state.
 */
export function useContacts(accountPubkey: string, liveDataEnabled = true) {
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.accountPubkey, accountPubkey))
      .orderBy(desc(contacts.addedAt)),
    [accountPubkey, liveDataEnabled],
    { enabled: liveDataEnabled },
  );
  return { contacts: data ?? [], loaded: updatedAt !== undefined };
}

/** Live single contact row (petname + saved state), or null when not saved. */
export function useContact(
  accountPubkey: string,
  pubkey: string,
  liveDataEnabled = true,
): ContactRow | null {
  const queryEnabled = liveDataEnabled && !!accountPubkey && !!pubkey;
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountPubkey, accountPubkey), eq(contacts.pubkey, pubkey)))
      .limit(1),
    [accountPubkey, pubkey, queryEnabled],
    { enabled: queryEnabled },
  );
  // `updatedAt === undefined` means the query hasn't resolved yet (`data` is `[]`
  // regardless); once it has, the result (row or null) is authoritative.
  const liveRow = updatedAt === undefined ? undefined : (data?.[0] ?? null);
  // …but `useLiveQuery` keeps the *previous* key's `data` (and `updatedAt` never
  // resets) for a frame after `(accountPubkey, pubkey)` changes, so the row in hand
  // can still belong to the old key. Caching it under the new key would briefly show
  // the previous contact's petname (cf. the persistent version of this in
  // `useProfile`). Treat a row that doesn't match the requested key as "not resolved
  // yet" → fall through to the warm read, which is correctly keyed.
  const live =
    liveRow && (liveRow.accountPubkey !== accountPubkey || liveRow.pubkey !== pubkey)
      ? undefined
      : liveRow;

  return useMemo(() => {
    if (live !== undefined) {
      contactCache.set(contactCacheKey(accountPubkey, pubkey), live);
      return live;
    }
    // First frame: use only the session cache. The database must never be read
    // synchronously during render.
    if (!accountPubkey || !pubkey) return null;
    return warmContact(accountPubkey, pubkey);
  }, [live, accountPubkey, pubkey]);
}

/**
 * Whether `pubkey` is a saved contact. `undefined` until the live query has
 * resolved, then `true` / `false` — so callers can avoid flashing UI (e.g. an
 * "add contact" prompt) during the brief window before the answer is known.
 */
export function useIsContact(
  accountPubkey: string,
  pubkey: string,
): boolean | undefined {
  // `data` starts as `[]` (not undefined) for a non-relational query, so it
  // can't tell "loading" from "no match". `updatedAt` is undefined until the
  // query first resolves — that's the real "not yet known" signal.
  const { data, updatedAt } = useLiveQuery(
    db
      .select({ accountPubkey: contacts.accountPubkey, pubkey: contacts.pubkey })
      .from(contacts)
      .where(and(eq(contacts.accountPubkey, accountPubkey), eq(contacts.pubkey, pubkey)))
      .limit(1),
    [accountPubkey, pubkey],
  );
  const queryKey = contactCacheKey(accountPubkey, pubkey);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  useEffect(() => {
    if (updatedAt === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedKey(queryKey);
    // `useLiveQuery` retains the previous result and timestamp when its deps
    // change. Only a new timestamp proves this key's query has resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);
  if (resolvedKey !== queryKey) return undefined;
  const row = data[0];
  if (row && (row.accountPubkey !== accountPubkey || row.pubkey !== pubkey)) {
    return undefined;
  }
  return row != null;
}
