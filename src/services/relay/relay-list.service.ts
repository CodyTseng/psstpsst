import { and, eq } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { relayLists, replaceableEvents } from '@/db/schema';
import {
  DISCOVERY_RELAYS,
  normalizeRelayUrl,
} from '@/lib/nostr/relay-url';

import { KIND_DM_RELAY_LIST, KIND_RELAY_LIST_METADATA } from '../crypto/nip17-gift-wrap';
import { prepareConfiguration, publishConfiguration } from './configuration-publish.service';
import { loadAccountDmRelays } from './local-relay-settings';
import { fetchReplaceable, parseRelayListMetadata, peerMetaRelays } from './relay-router';
import {
  ensureReplaceableFresh,
  getReplaceableEvent,
  markReplaceableFetched,
  REPLACEABLE_DEFAULT_TTL_SECONDS,
  storeReplaceableEvent,
} from './replaceable-events.service';
import type { Signer } from '../signer/signer.interface';

const NORMALIZED_DISCOVERY = DISCOVERY_RELAYS.map(normalizeRelayUrl);

export { loadAccountDmRelays } from './local-relay-settings';

/** Hot session cache of peers' DM relay lists, layered over the persisted
 * `replaceable_events` row (kind 10050, 24h TTL): within {@link DM_RELAYS_TTL_MS}
 * a send skips even the database read. Only non-empty results are cached here; a
 * confirmed miss lives in the table as a negative-cache row, so it is not
 * re-queried until the TTL lapses. `createdAt` is the cached event's timestamp
 * (newer wins for live updates); `at` is the fetch time (for TTL). Kept fresh by
 * the peer subscription via `applyDmRelayListEvent`. */
const DM_RELAYS_TTL_MS = 10 * 60 * 1000;
const dmRelaysCache = new Map<
  string,
  { relays: string[]; createdAt: number; at: number }
>();

/** Parse relay URLs out of a kind-10050 event's `relay` tags. */
function parseRelayTags(event: Event): string[] {
  return event.tags
    .filter((t) => t[0] === 'relay' && t[1])
    .map((t) => {
      try {
        return normalizeRelayUrl(t[1]);
      } catch {
        return null;
      }
    })
    .filter((u): u is string => u !== null);
}

/** Apply a kind-10050 event observed live (peer subscription) to the cache,
 * newest-wins. Lets an open chat pick up the peer changing their DM relays,
 * exactly like the encryption-key subscription does for key rotation. The event
 * is also persisted to the shared replaceable-events table so a cold start
 * doesn't re-query. */
export function applyDmRelayListEvent(event: Event): void {
  if (event.kind !== KIND_DM_RELAY_LIST) return;
  // Fire-and-forget: the live path stays synchronous; the store is newest-wins.
  void storeReplaceableEvent(event).catch(() => undefined);
  const existing = dmRelaysCache.get(event.pubkey);
  if (existing && existing.createdAt >= event.created_at) return;
  const relays = parseRelayTags(event);
  if (relays.length === 0) return;
  dmRelaysCache.set(event.pubkey, {
    relays,
    createdAt: event.created_at,
    at: Date.now(),
  });
}

/**
 * Apply the account's **own** kind-10050 observed live (self-event stream) to
 * the local `relay_lists` table — newest-wins against the rows' `updatedAt`.
 * Distinct from {@link applyDmRelayListEvent}, which maintains the *peer*
 * cache: the account's own DM list is the local table `loadAccountDmRelays`
 * reads, and another device may have changed it. Returns true only when the
 * table actually changed, so the caller can rebuild its relay demand.
 */
export async function applyOwnDmRelayListEvent(
  accountPubkey: string,
  event: Event,
): Promise<boolean> {
  if (event.kind !== KIND_DM_RELAY_LIST || event.pubkey !== accountPubkey) return false;
  const rows = await db
    .select({ updatedAt: relayLists.updatedAt })
    .from(relayLists)
    .where(eq(relayLists.accountPubkey, accountPubkey));
  const currentUpdatedAt = rows.reduce((max, r) => Math.max(max, r.updatedAt), 0);
  if (currentUpdatedAt >= event.created_at) return false;
  const relays = parseRelayTags(event);
  await db.transaction(async (tx) => {
    await tx.delete(relayLists).where(eq(relayLists.accountPubkey, accountPubkey)).run();
    for (const url of relays) {
      await tx
        .insert(relayLists)
        .values({
          accountPubkey,
          relayUrl: url,
          read: false,
          write: false,
          updatedAt: event.created_at,
        })
        .run();
    }
  });
  return true;
}

/** Read the persisted kind-10050 row (event + last-confirmed time) from the
 * shared replaceable-events table. `event` is null on a confirmed miss. */
async function readStoredDmRelayList(
  pubkey: string,
): Promise<{ event: Event | null; fetchedAt: number } | null> {
  const rows = await db
    .select({ event: replaceableEvents.event, fetchedAt: replaceableEvents.fetchedAt })
    .from(replaceableEvents)
    .where(
      and(
        eq(replaceableEvents.pubkey, pubkey),
        eq(replaceableEvents.kind, KIND_DM_RELAY_LIST),
        eq(replaceableEvents.dTag, ''),
      ),
    );
  return rows[0] ?? null;
}

/** Fetch a pubkey's NIP-17 DM relays (kind 10050) — the *full, true* list, for
 * the cache. Cache layers: in-memory Map → persisted replaceable-events row
 * (24h TTL, including negative-cache misses) → the peer's outbox relays (their
 * NIP-65 write relays, count-guarded, ∪ discovery) via the shared
 * batched/deduped loader. Callers that deliver to these relays must cap the
 * result (`capDeliveryRelays`). */
export async function fetchDmRelays(opts: {
  pubkey: string;
  /** Extra relays to also consult (e.g. a relay hint). The peer's outbox +
   * discovery relays are always included. */
  searchRelays?: string[];
  /** Skip the caches and re-query relays (used by manual "recheck"). */
  force?: boolean;
  /** Called only after all caches miss and a relay lookup will begin. */
  onRelayQuery?: () => void;
}): Promise<string[]> {
  const cached = dmRelaysCache.get(opts.pubkey);
  if (!opts.force && cached && Date.now() - cached.at < DM_RELAYS_TTL_MS) return cached.relays;

  if (!opts.force) {
    const stored = await readStoredDmRelayList(opts.pubkey);
    const fresh =
      stored != null &&
      Date.now() - stored.fetchedAt * 1000 < REPLACEABLE_DEFAULT_TTL_SECONDS * 1000;
    if (fresh) {
      // A stored event answers from local state; a null event is a confirmed
      // miss (negative cache) — either way, relays are not re-asked within the
      // TTL.
      const relays = stored.event ? parseRelayTags(stored.event) : [];
      if (stored.event && relays.length > 0) {
        dmRelaysCache.set(opts.pubkey, {
          relays,
          createdAt: stored.event.created_at,
          at: Date.now(),
        });
      }
      return relays;
    }
  }

  opts.onRelayQuery?.();
  const metaRelays = await peerMetaRelays(opts.pubkey);
  const targets = Array.from(new Set([...(opts.searchRelays ?? []), ...metaRelays]));
  const key = { pubkey: opts.pubkey, kind: KIND_DM_RELAY_LIST };
  const event = await fetchReplaceable(targets, KIND_DM_RELAY_LIST, opts.pubkey);
  if (!event) {
    // Confirmed miss: persist a negative-cache mark so this peer's DM relays
    // aren't re-queried until the TTL lapses.
    await markReplaceableFetched(key);
    return [];
  }
  await storeReplaceableEvent(event);
  const relays = parseRelayTags(event);

  if (relays.length > 0) {
    const current = dmRelaysCache.get(opts.pubkey);
    if (current && current.createdAt >= event.created_at) return current.relays;
    dmRelaysCache.set(opts.pubkey, {
      relays,
      createdAt: event.created_at,
      at: Date.now(),
    });
  }
  return relays;
}

/** The account's own NIP-65 kind-10002 event, from the shared replaceable-events
 * cache. The TTL gate runs first, so repeat calls (every own-relay resolver
 * passes through here) cost a local read and zero network while the row is
 * fresh; a stale/missing row triggers the single bootstrap query against the
 * discovery relays before the re-read. */
async function loadOwnRelayListMetadata(accountPubkey: string): Promise<Event | null> {
  const key = { pubkey: accountPubkey, kind: KIND_RELAY_LIST_METADATA };
  await ensureReplaceableFresh([key], {
    ttlSeconds: REPLACEABLE_DEFAULT_TTL_SECONDS,
    relays: NORMALIZED_DISCOVERY,
  }).catch(() => undefined);
  return getReplaceableEvent(key);
}

/**
 * The account's NIP-65 **write** relays (its outbox — where its own events are
 * published so peers can find them), parsed from its kind-10002 relay list.
 * This is deliberately independent from the account's private-message inbox.
 * Falls back to the discovery set when no list is known.
 */
export async function loadAccountWriteRelays(accountPubkey: string): Promise<string[]> {
  const event = await loadOwnRelayListMetadata(accountPubkey);
  const write = event ? parseRelayListMetadata(event).write : [];
  return write.length > 0 ? write : [...NORMALIZED_DISCOVERY];
}

/** Edit only the write side of NIP-65. Refresh first, then merge from the latest
 * persisted event; an unavailable lookup must never become an empty template.
 * Work is bounded by relay metadata, independent of conversation history. */
export function saveAndPublishWriteRelays(opts: {
  accountPubkey: string;
  signer: Signer;
  relays: string[];
}): Promise<Event> {
  return prepareConfiguration(opts.accountPubkey, KIND_RELAY_LIST_METADATA, '', async () => {
    const write = Array.from(new Set(opts.relays.map(normalizeRelayUrl)));
    if (write.length === 0) throw new Error('At least one write relay is required.');
    const key = { pubkey: opts.accountPubkey, kind: KIND_RELAY_LIST_METADATA };
    const cached = await getReplaceableEvent(key);
    const targets = Array.from(new Set([
      ...NORMALIZED_DISCOVERY, ...write,
      ...(cached ? parseRelayListMetadata(cached).write : []),
    ]));
    const remote = await fetchReplaceable(targets, key.kind, key.pubkey);
    if (remote) await storeReplaceableEvent(remote);
    const current = await getReplaceableEvent(key);
    const tags: string[][] = [];
    for (const tag of current?.tags ?? []) {
      if (tag[0] !== 'r' || !tag[1]) {
        tags.push(tag);
      } else if (tag[2] === undefined || tag[2] === '') {
        // An absent or empty marker also grants read membership. Removing its write side
        // must leave that read membership (and any extension fields) intact.
        tags.push([tag[0], tag[1], 'read', ...tag.slice(3)]);
      } else if (tag[2] !== 'write') {
        tags.push(tag);
      }
    }
    tags.push(...write.map((url) => ['r', url, 'write']));
    return publishConfiguration(opts.accountPubkey, opts.signer, {
      kind: key.kind, tags, content: current?.content ?? '', created_at: Math.floor(Date.now() / 1000),
    }, undefined, current?.id ?? null);
  });
}

/**
 * Own DM ∪ write — the account-local route for the 4454/4455 multi-device
 * key-transfer exchange. Keeping this distinct from `ownKeyAnnouncementRelays`
 * lets the transfer follow the configured write relays without adding extra
 * discovery-only targets.
 */
export async function ownKeyTransferRelays(accountPubkey: string): Promise<string[]> {
  const [dm, write] = await Promise.all([
    loadAccountDmRelays(accountPubkey),
    loadAccountWriteRelays(accountPubkey),
  ]);
  return Array.from(new Set([...dm, ...write]));
}

/** The account's NIP-65 **read** relays, parsed from its kind-10002 relay list.
 * Kept separate from DM relays; falls back to the discovery set when no list is
 * known. */
export async function loadAccountReadRelays(accountPubkey: string): Promise<string[]> {
  const event = await loadOwnRelayListMetadata(accountPubkey);
  const read = event ? parseRelayListMetadata(event).read : [];
  return read.length > 0 ? read : [...NORMALIZED_DISCOVERY];
}

/**
 * Own DM ∪ write ∪ discovery — the publish/lookup target for the **kind-10044
 * encryption-key announcement** specifically. Unlike the 4454/4455 key-transfer
 * events (which use the account's DM ∪ write relays), the announcement also goes
 * to the big discovery relays so a fresh device of ours — or a peer — can always
 * recover the current encryption key by bootstrapping from the well-known relays,
 * even if our DM/write relays are unreachable.
 */
export async function ownKeyAnnouncementRelays(accountPubkey: string): Promise<string[]> {
  const [dm, write] = await Promise.all([
    loadAccountDmRelays(accountPubkey),
    loadAccountWriteRelays(accountPubkey),
  ]);
  return Array.from(new Set([...dm, ...write, ...NORMALIZED_DISCOVERY]));
}

/**
 * Own write relays ∪ discovery — where we publish our public replaceable lists
 * (kind 0 / 10050 / 10063, and the private 30000 sets) and read them back, so
 * peers and our own other devices can find them by bootstrapping from the big
 * relays. The single home for the "outbox ∪ discovery" target.
 */
export async function ownMetaRelays(accountPubkey: string): Promise<string[]> {
  const write = await loadAccountWriteRelays(accountPubkey);
  return Array.from(new Set([...write, ...NORMALIZED_DISCOVERY]));
}

/** Replace the current account's DM relay list and publish kind 10050. */
export async function saveAndPublishDmRelays(opts: {
  accountPubkey: string;
  signer: Signer;
  relays: string[];
}): Promise<void> {
  const normalized = opts.relays.map(normalizeRelayUrl);
  const now = Math.floor(Date.now() / 1000);

  await db.transaction(async (tx) => {
    await tx.delete(relayLists).where(eq(relayLists.accountPubkey, opts.accountPubkey)).run();
    for (const url of normalized) {
      await tx
        .insert(relayLists)
        .values({
          accountPubkey: opts.accountPubkey,
          relayUrl: url,
          read: false,
          write: false,
          updatedAt: now,
        })
        .run();
    }
  });

  await publishConfiguration(opts.accountPubkey, opts.signer, {
    kind: KIND_DM_RELAY_LIST,
    content: '',
    tags: normalized.map((u) => ['relay', u]),
    created_at: now,
  });
}
