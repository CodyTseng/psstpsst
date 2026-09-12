import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { encryptionKeyAnnouncements } from '@/db/schema';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import {
  KIND_DM_RELAY_LIST,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_RELAY_LIST_METADATA,
} from '../crypto/nip17-gift-wrap';
import { applyDmRelayListEvent, fetchDmRelays } from '../relay/relay-list.service';
import { relayPool } from '../relay/relay-pool';
import {
  applyRelayListMetadataEvent,
  capDeliveryRelays,
  pickPeerRelays,
  resolvePeerOutbox,
  uniq,
} from '../relay/relay-router';

const FORCE_REFRESH_TIMEOUT_MS = 10_000;
const RESOLVE_TIMEOUT_MS = 10_000;
const NORMALIZED_DISCOVERY = DISCOVERY_RELAYS.map(normalizeRelayUrl);

type CacheEntry = {
  encryptionPubkey: string;
  createdAt: number;
};

class EncryptionKeyWatcher {
  private dmRelays: string[] = [];
  private cache = new Map<string, CacheEntry>();
  private watched = new Map<string, number>(); // identity pubkey → refcount
  private activeSub: (() => void) | null = null;
  /** Bumped on every (re)build / teardown so an async relay-resolution that
   * started for an older watched set discards itself instead of opening a
   * stale subscription. */
  private subGen = 0;

  async init(opts: { dmRelays: string[] }): Promise<void> {
    this.dmRelays = opts.dmRelays;
    this.cache.clear();
    const rows = await db.select().from(encryptionKeyAnnouncements);
    for (const row of rows) {
      this.cache.set(row.pubkey, {
        encryptionPubkey: row.encryptionPubkey,
        createdAt: row.eventCreatedAt,
      });
    }
  }

  destroy(): void {
    this.subGen++;
    this.activeSub?.();
    this.activeSub = null;
    this.watched.clear();
    this.cache.clear();
    this.dmRelays = [];
  }

  /**
   * Where to read a peer's DM-metadata events (10044 / 10050 / 10002): the
   * first few of their NIP-65 write relays plus their (capped) DM relays — the
   * relays they actually publish to. No big discovery relays here (the
   * maintainer dropped them for key events); only when we know none of the
   * peer's relays do we fall back to our own DM relays + discovery, so a
   * never-seen peer can still be resolved.
   */
  private async peerKeyRelays(identity: string): Promise<string[]> {
    const [{ write }, dm] = await Promise.all([
      // A failed routing lookup is not a cached miss. Keep the existing fallback
      // relays usable so live subscriptions can reconnect when the network returns.
      resolvePeerOutbox(identity).catch(() => ({ write: [] as string[] })),
      fetchDmRelays({ pubkey: identity }).catch(() => [] as string[]),
    ]);
    const relays = uniq([...pickPeerRelays(write), ...capDeliveryRelays(dm)]);
    return relays.length > 0 ? relays : uniq([...this.dmRelays, ...NORMALIZED_DISCOVERY]);
  }

  /** Look up: cache → relay query (with 6s timeout). */
  async resolve(identity: string, onRelayQuery?: () => void): Promise<string | null> {
    const cached = this.cache.get(identity);
    if (cached) return cached.encryptionPubkey;
    onRelayQuery?.();
    await this.queryRelaysAndStore(identity, RESOLVE_TIMEOUT_MS);
    return this.cache.get(identity)?.encryptionPubkey ?? null;
  }

  /** Force a relay query; fall back to cache on timeout. */
  async forceRefresh(identity: string, onRelayQuery?: () => void): Promise<string | null> {
    onRelayQuery?.();
    await this.queryRelaysAndStore(identity, FORCE_REFRESH_TIMEOUT_MS);
    return this.cache.get(identity)?.encryptionPubkey ?? null;
  }

  /** Reference-counted live subscription. Single underlying REQ for the union of watched pubkeys. */
  watch(identities: string[]): () => void {
    let setChanged = false;
    for (const id of identities) {
      const cur = this.watched.get(id) ?? 0;
      if (cur === 0) setChanged = true;
      this.watched.set(id, cur + 1);
    }
    if (setChanged) this.rebuildSubscription();

    return () => {
      let dropChanged = false;
      for (const id of identities) {
        const cur = this.watched.get(id) ?? 0;
        if (cur <= 1) {
          this.watched.delete(id);
          dropChanged = true;
        } else {
          this.watched.set(id, cur - 1);
        }
      }
      if (dropChanged) this.rebuildSubscription();
    };
  }

  private rebuildSubscription(): void {
    this.activeSub?.();
    this.activeSub = null;
    const gen = ++this.subGen;
    if (this.watched.size === 0) return;
    const authors = Array.from(this.watched.keys());
    // Resolve each watched peer's own relays, then open ONE REQ over their union
    // (relays cap concurrent subscriptions, so we never open a sub per peer). The
    // single REQ tracks each peer's replaceable DM-metadata — encryption key
    // (10044), DM relay list (10050), and NIP-65 relays (10002) — all of which
    // can change at any time, so an open chat must stay subscribed to each.
    void (async () => {
      const sets = await Promise.all(authors.map((a) => this.peerKeyRelays(a)));
      // Bail if the watched set turned over (or we were destroyed) while resolving.
      if (gen !== this.subGen || this.watched.size === 0) return;
      const relays = uniq(sets.flat());
      if (relays.length === 0) return;
      this.activeSub = relayPool.subscribe({
        relays,
        filter: {
          kinds: [
            KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
            KIND_DM_RELAY_LIST,
            KIND_RELAY_LIST_METADATA,
          ],
          authors,
        },
        onEvent: (e) => {
          if (e.kind === KIND_DM_RELAY_LIST) applyDmRelayListEvent(e);
          else if (e.kind === KIND_RELAY_LIST_METADATA) applyRelayListMetadataEvent(e);
          else void this.handleAnnouncement(e);
        },
      });
    })();
  }

  private async queryRelaysAndStore(identity: string, timeoutMs: number): Promise<void> {
    const relays = await this.peerKeyRelays(identity);
    if (relays.length === 0) return;
    const events = await relayPool.query({
      relays,
      filter: { kinds: [KIND_ENCRYPTION_KEY_ANNOUNCEMENT], authors: [identity], limit: 1 },
      timeoutMs,
    });
    if (events.length === 0) return;
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    await this.handleAnnouncement(latest);
  }

  private async handleAnnouncement(event: Event): Promise<void> {
    if (event.kind !== KIND_ENCRYPTION_KEY_ANNOUNCEMENT) return;
    const nTag = event.tags.find((t) => t[0] === 'n');
    if (!nTag || !nTag[1]) return;

    const identity = event.pubkey;
    const encryptionPubkey = nTag[1];
    const createdAt = event.created_at;

    const existing = this.cache.get(identity);
    if (existing && existing.createdAt >= createdAt) return;

    this.cache.set(identity, { encryptionPubkey, createdAt });

    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(encryptionKeyAnnouncements)
      .values({
        pubkey: identity,
        encryptionPubkey,
        eventId: event.id,
        eventCreatedAt: createdAt,
        rawEvent: event,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: encryptionKeyAnnouncements.pubkey,
        set: {
          encryptionPubkey,
          eventId: event.id,
          eventCreatedAt: createdAt,
          rawEvent: event,
          fetchedAt: now,
        },
      });
  }
}

export const encryptionKeyWatcher = new EncryptionKeyWatcher();
