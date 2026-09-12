import { and, eq } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { replaceableEvents } from '@/db/schema';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { KIND_RELAY_LIST_METADATA } from '../crypto/nip17-gift-wrap';
import { relayPool } from './relay-pool';
import { loadAccountDmRelays } from './local-relay-settings';
import { RelayQueryError } from './relay-query-error';
import type { QueryRelayResult } from './managed-relay-pool';
import {
  getReplaceableEvent,
  markReplaceableFetched,
  storeReplaceableEvent,
} from './replaceable-events.service';

/**
 * The relay router — the single place that answers "which relays for whom",
 * following the NIP-65 outbox model with two hard guards the maintainer set:
 *
 *  1. **Relay-count control** ({@link pickPeerRelays}). A peer's advertised list
 *     is untrusted input: we read at most the first {@link MAX_PEER_RELAYS}, and
 *     a bloated list (> {@link DISCARD_THRESHOLD}) is dropped wholesale in favour
 *     of the big discovery relays — so one peer can't fan our REQs out to dozens
 *     of relays.
 *  2. **Batch + dedup** ({@link fetchReplaceable}). Relays cap concurrent
 *     subscriptions, so we never open a REQ per (pubkey, kind): requests queued
 *     in the same tick are coalesced **per relay** (one REQ per relay per kind,
 *     unioning authors), so a relay two callers share is hit once — not once per
 *     relay *set*. An identical in-flight request rides the existing promise (a
 *     small DataLoader).
 *
 * Local inbox reads live in `local-relay-settings`, below routing/publication.
 * This module owns configuration publish routing, peer routing, and batched fetch.
 */

const NORMALIZED_DISCOVERY = DISCOVERY_RELAYS.map(normalizeRelayUrl);

/** Resolve each attempt from current local configuration, never persisted targets.
 * Key announcements also reach inbox relays; routing lists remain discoverable. */
export async function configurationPublishRelays(event: Event): Promise<string[]> {
  // Publishing must not depend on a successful metadata refresh. Bootstrap and
  // self-event intake reconcile remote configuration separately.
  const [metadata, inbox] = await Promise.all([
    getReplaceableEvent({ pubkey: event.pubkey, kind: KIND_RELAY_LIST_METADATA }),
    event.kind === 10044 ? loadAccountDmRelays(event.pubkey) : Promise.resolve([]),
  ]);
  const write = metadata ? parseRelayListMetadata(metadata).write : [];
  const urls = [...inbox, ...write, ...NORMALIZED_DISCOVERY];
  return Array.from(new Set(urls.map(normalizeRelayUrl)));
}

/** At most this many relays are honoured from a peer's advertised list. */
export const MAX_PEER_RELAYS = 4;
/** A peer advertising more than this many relays is treated as junk: the whole
 * list is discarded (callers fall back to the discovery relays). */
export const DISCARD_THRESHOLD = 10;

const PEER_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Apply the count guard to a peer's advertised relay list: drop it entirely when
 * it's implausibly long (caller substitutes discovery relays), else keep the
 * first {@link MAX_PEER_RELAYS}. **Only valid for relays we can substitute** —
 * never for DM *delivery* (a gift wrap must reach the peer's real DM relays; the
 * big relays can't stand in). For delivery use {@link capDeliveryRelays}.
 */
export function pickPeerRelays(list: string[]): string[] {
  if (list.length > DISCARD_THRESHOLD) return [];
  return list.slice(0, MAX_PEER_RELAYS);
}

/** Cap a peer's DM relays for *delivery*: first {@link MAX_PEER_RELAYS}, never
 * discarded — there's no public substitute for someone's private inbox. */
export function capDeliveryRelays(list: string[]): string[] {
  return list.slice(0, MAX_PEER_RELAYS);
}

/** Dedupe a list of relay URLs, preserving first-seen order. */
export function uniq(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

/** A stable signature for an **already normalized + deduped** relay set, so
 * requests targeting the same relays batch together regardless of order. */
function relaySig(relays: string[]): string {
  return [...relays].sort().join('\n');
}

// ─── Batched, deduped replaceable-event fetch (the DataLoader) ───────────────

type Waiter = {
  kind: number;
  author: string;
  relays: string[];
  resolve: (e: Event | null) => void;
  reject: (error: unknown) => void;
  groups: Set<QueryGroup>;
  failures: QueryRelayResult[];
  latest: Event | null;
  completed: boolean;
};
type QueryGroup = {
  relay: string;
  kind: number;
  authors: Map<string, Set<Waiter>>;
  waiters: Set<Waiter>;
};

const BATCH_TIMEOUT_MS = 10_000;

/** Everything queued in this tick: the per-(relay, kind, author) demand and the
 * waiters to resolve once the relays answer. */
let pending: Waiter[] | null = null;
/** In-flight single requests, keyed by `sig|kind|author`, so concurrent callers
 * asking for the same replaceable event share one promise. */
const inflight = new Map<string, Promise<Event | null>>();

function flush(): void {
  const batch = pending;
  pending = null;
  if (!batch) return;

  // Group demand by (relay, kind) — NOT by relay *set*. So if one caller wants
  // author X from {A,B} and another wants Y from {B,C}, relay B is queried
  // exactly once (for {X, Y}), instead of twice (once per set). Splitting on
  // kind too keeps each REQ's `{kinds, authors}` filter from fanning out into a
  // kind×author cross product we never asked for.
  const groups = new Map<string, QueryGroup>();
  for (const waiter of batch) {
    for (const relay of waiter.relays) {
      const gkey = `${relay}:${waiter.kind}`;
      let group = groups.get(gkey);
      if (!group) {
        group = {
          relay, kind: waiter.kind, authors: new Map(), waiters: new Set(),
        };
        groups.set(gkey, group);
      }
      const consumers = group.authors.get(waiter.author) ?? new Set<Waiter>();
      consumers.add(waiter);
      group.authors.set(waiter.author, consumers);
      group.waiters.add(waiter);
      waiter.groups.add(group);
    }
  }
  for (const group of groups.values()) void runGroup(group);
}

async function runGroup(group: QueryGroup): Promise<void> {
  const receive = (event: Event) => {
    if (event.kind !== group.kind) return;
    for (const waiter of group.authors.get(event.pubkey) ?? []) {
      const previous = waiter.latest;
      if (!previous || event.created_at > previous.created_at ||
          (event.created_at === previous.created_at && event.id < previous.id)) {
        waiter.latest = event;
      }
    }
  };
  try {
    const events = await relayPool.query({
      relays: [group.relay],
      filter: { kinds: [group.kind], authors: Array.from(group.authors.keys()) },
      timeoutMs: BATCH_TIMEOUT_MS,
      onEvent: receive,
    });
    for (const event of events) receive(event);
    for (const waiter of group.waiters) {
      waiter.completed = true;
    }
  } catch (error) {
    for (const waiter of group.waiters) {
      if (error instanceof RelayQueryError) waiter.failures.push(...error.relayResults);
    }
  } finally {
    // Each caller waits for its own relay set, independent of unrelated peers.
    for (const waiter of group.waiters) {
      waiter.groups.delete(group);
      if (waiter.groups.size > 0) continue;
      if (waiter.completed) waiter.resolve(waiter.latest);
      else waiter.reject(new RelayQueryError(waiter.failures));
    }
    group.waiters.clear();
    group.authors.clear();
  }
}

/**
 * Fetch the newest replaceable event of `kind` authored by `pubkey` from
 * `relays`. Everything queued in the same tick is coalesced **per relay** (one
 * REQ per relay per kind, with the union of authors), so a relay shared across
 * requests is hit once; identical concurrent calls dedup onto one promise.
 * Waits for every target relay to settle, then returns the newest received event.
 * Returns null on a completed miss; rejects when all target relays fail.
 */
export function fetchReplaceable(
  relays: string[],
  kind: number,
  pubkey: string,
): Promise<Event | null> {
  const targets = uniq(relays.map(normalizeRelayUrl));
  if (targets.length === 0) return Promise.reject(new RelayQueryError([]));
  const key = `${relaySig(targets)}|${kind}|${pubkey}`;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = new Promise<Event | null>((resolve, reject) => {
    if (!pending) {
      pending = [];
      // Coalesce everything queued in this tick, then fire one REQ per relay.
      queueMicrotask(flush);
    }
    pending.push({
      relays: targets, kind, author: pubkey, resolve, reject,
      groups: new Set(), failures: [], latest: null, completed: false,
    });
  }).finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

// ─── Peer outbox (NIP-65 kind 10002) resolution ─────────────────────────────

type OutboxEntry = {
  write: string[];
  read: string[];
  event: Event | null;
  createdAt: number;
  at: number;
};
const outboxCache = new Map<string, OutboxEntry>();
const outboxInflight = new Map<string, Promise<OutboxEntry>>();

/** Parse supported NIP-65 memberships. An absent or empty marker grants both roles;
 * unknown markers grant neither membership, without modifying the event. */
export function parseRelayListMetadata(event: Event): { write: string[]; read: string[] } {
  const write: string[] = [];
  const read: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    let url: string;
    try {
      url = normalizeRelayUrl(tag[1]);
    } catch {
      continue;
    }
    const marker = tag[2];
    if (marker === 'write') write.push(url);
    else if (marker === 'read') read.push(url);
    else if (marker === undefined || marker === '') {
      write.push(url);
      read.push(url);
    }
  }
  return { write: uniq(write), read: uniq(read) };
}

function outboxEntry(event: Event | null, fetchedAt: number): OutboxEntry {
  const parsed = event ? parseRelayListMetadata(event) : { write: [], read: [] };
  return {
    ...parsed,
    event,
    createdAt: event?.created_at ?? 0,
    at: fetchedAt,
  };
}

function isRelayMetadataEvent(event: Event | null, pubkey: string): event is Event {
  return event?.kind === KIND_RELAY_LIST_METADATA && event.pubkey === pubkey;
}

async function refreshPeerOutbox(pubkey: string): Promise<OutboxEntry> {
  const existing = outboxInflight.get(pubkey);
  if (existing) return existing;

  const promise = (async () => {
    const fetched = await fetchReplaceable(
      NORMALIZED_DISCOVERY,
      KIND_RELAY_LIST_METADATA,
      pubkey,
    );
    // Persist through the shared replaceable-events cache: a hit stores the event
    // (newest-wins, fetchedAt = now), a miss records a negative-cache mark so the
    // peer isn't re-queried until the TTL lapses.
    if (fetched) await storeReplaceableEvent(fetched);
    else await markReplaceableFetched({ pubkey, kind: KIND_RELAY_LIST_METADATA });
    const current = outboxCache.get(pubkey);
    const event =
      current?.event && (!fetched || current.event.created_at >= fetched.created_at)
        ? current.event
        : fetched;
    const entry = outboxEntry(event, Date.now());
    outboxCache.set(pubkey, entry);
    return entry;
  })().finally(() => outboxInflight.delete(pubkey));

  outboxInflight.set(pubkey, promise);
  return promise;
}

/**
 * Resolve a peer's NIP-65 read/write relays (kind 10002), always bootstrapped
 * from the discovery relays. The persisted one-day cache returns immediately;
 * stale rows refresh in the background. An absent list is cached as empty so
 * callers can fall back to discovery without repeating the same lookup.
 */
export async function resolvePeerOutbox(pubkey: string): Promise<OutboxEntry> {
  const cached = outboxCache.get(pubkey);
  if (cached) {
    if (Date.now() - cached.at >= PEER_OUTBOX_TTL_MS) {
      void refreshPeerOutbox(pubkey).catch(() => undefined);
    }
    return cached;
  }

  const rows = await db
    .select({ event: replaceableEvents.event, fetchedAt: replaceableEvents.fetchedAt })
    .from(replaceableEvents)
    .where(
      and(
        eq(replaceableEvents.pubkey, pubkey),
        eq(replaceableEvents.kind, KIND_RELAY_LIST_METADATA),
        eq(replaceableEvents.dTag, ''),
      ),
    )
    .limit(1);
  const persisted = rows[0];
  if (persisted) {
    const event = isRelayMetadataEvent(persisted.event, pubkey) ? persisted.event : null;
    const entry = outboxEntry(event, persisted.fetchedAt * 1000);
    outboxCache.set(pubkey, entry);
    if (Date.now() - entry.at >= PEER_OUTBOX_TTL_MS) {
      void refreshPeerOutbox(pubkey).catch(() => undefined);
    }
    return entry;
  }

  return refreshPeerOutbox(pubkey);
}

/**
 * Where to **read** a peer's discoverable metadata (kind 0 profile, 10050 DM
 * relay list, 10063 media servers): the first few of their NIP-65 write relays
 * (count-guarded) unioned with the discovery relays, which always backstop a
 * missing/bloated list.
 */
export async function peerMetaRelays(pubkey: string): Promise<string[]> {
  const { write } = await resolvePeerOutbox(pubkey);
  return uniq([...pickPeerRelays(write), ...NORMALIZED_DISCOVERY]);
}

/** Seed/refresh the peer-outbox cache from a kind-10002 event seen live (e.g. a
 * relay subscription), newest-wins-by-arrival (TTL refreshes on every observe). */
export function applyRelayListMetadataEvent(event: Event): void {
  if (event.kind !== KIND_RELAY_LIST_METADATA) return;
  const existing = outboxCache.get(event.pubkey);
  if (existing && existing.createdAt > event.created_at) return;
  const fetchedAt = Date.now();
  const accepted = existing?.createdAt === event.created_at ? existing.event ?? event : event;
  const entry = outboxEntry(accepted, fetchedAt);
  outboxCache.set(event.pubkey, entry);
  void storeReplaceableEvent(accepted).catch(() => undefined);
}
