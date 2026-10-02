import { eq } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { encryptionKeyAnnouncements } from '@/db/schema';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { KIND_ENCRYPTION_KEY_ANNOUNCEMENT } from '../crypto/nip17-gift-wrap';
import { fetchDmRelays } from '../relay/relay-list.service';
import { relayPool } from '../relay/relay-pool';
import {
  capDeliveryRelays,
  pickPeerRelays,
  resolvePeerOutbox,
  uniq,
} from '../relay/relay-router';

const FORCE_REFRESH_TIMEOUT_MS = 10_000;
const RESOLVE_TIMEOUT_MS = 10_000;
const NORMALIZED_DISCOVERY = DISCOVERY_RELAYS.map(normalizeRelayUrl);

export type EncryptionKeyAnnouncement = {
  encryptionPubkey: string;
  createdAt: number;
  eventId: string;
  fetchedAt: number;
};

class EncryptionKeyWatcher {
  private dmRelays: string[] = [];
  private cache = new Map<string, EncryptionKeyAnnouncement>();
  private loadedFromDb = new Set<string>();
  private dbLoads = new Map<string, Promise<EncryptionKeyAnnouncement | null>>();
  private refreshes = new Map<string, Promise<EncryptionKeyAnnouncement | null>>();
  /** Bumped on teardown so an in-flight query from an older account discards itself. */
  private subGen = 0;

  async init(opts: { dmRelays: string[] }): Promise<void> {
    this.dmRelays = opts.dmRelays;
    // Announcements can grow with every peer ever contacted. Load one identity
    // on demand instead of copying the whole table into memory at startup.
    this.cache.clear();
    this.loadedFromDb.clear();
    this.dbLoads.clear();
    this.refreshes.clear();
  }

  destroy(): void {
    this.subGen++;
    this.cache.clear();
    this.loadedFromDb.clear();
    this.dbLoads.clear();
    this.refreshes.clear();
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
    return (await this.resolveAnnouncement(identity, onRelayQuery))?.encryptionPubkey ?? null;
  }

  peekAnnouncement(identity: string): EncryptionKeyAnnouncement | null {
    return this.cache.get(identity) ?? null;
  }

  async resolveAnnouncement(
    identity: string,
    onRelayQuery?: () => void,
  ): Promise<EncryptionKeyAnnouncement | null> {
    const cached = this.cache.get(identity);
    if (cached) return cached;
    const stored = await this.loadStoredAnnouncement(identity);
    if (stored) return stored;
    onRelayQuery?.();
    await this.queryRelaysAndStore(identity, RESOLVE_TIMEOUT_MS);
    return this.cache.get(identity) ?? null;
  }

  /** Force a relay query; fall back to cache on timeout. */
  async forceRefresh(identity: string, onRelayQuery?: () => void): Promise<string | null> {
    return (await this.forceRefreshAnnouncement(identity, onRelayQuery))?.encryptionPubkey ?? null;
  }

  async forceRefreshAnnouncement(
    identity: string,
    onRelayQuery?: () => void,
  ): Promise<EncryptionKeyAnnouncement | null> {
    await this.loadStoredAnnouncement(identity);
    onRelayQuery?.();
    await this.queryRelaysAndStore(identity, FORCE_REFRESH_TIMEOUT_MS);
    return this.cache.get(identity) ?? null;
  }

  /** Read local freshness first; use a one-shot relay query only for stale or missing data. */
  async refreshAnnouncementIfStale(
    identity: string,
    ttlSeconds: number,
    now = Math.floor(Date.now() / 1000),
  ): Promise<EncryptionKeyAnnouncement | null> {
    const active = this.refreshes.get(identity);
    if (active) return active;
    const refresh = (async () => {
      const stored = await this.loadStoredAnnouncement(identity);
      if (stored && now - stored.fetchedAt < ttlSeconds) return stored;
      await this.queryRelaysAndStore(identity, FORCE_REFRESH_TIMEOUT_MS, now);
      return this.cache.get(identity) ?? stored;
    })();
    this.refreshes.set(identity, refresh);
    try {
      return await refresh;
    } finally {
      if (this.refreshes.get(identity) === refresh) this.refreshes.delete(identity);
    }
  }

  private async queryRelaysAndStore(
    identity: string,
    timeoutMs: number,
    fetchedAt = Math.floor(Date.now() / 1000),
  ): Promise<void> {
    const generation = this.subGen;
    const relays = await this.peerKeyRelays(identity);
    if (relays.length === 0) return;
    const events = await relayPool.query({
      relays,
      filter: { kinds: [KIND_ENCRYPTION_KEY_ANNOUNCEMENT], authors: [identity], limit: 1 },
      timeoutMs,
    });
    if (events.length === 0) {
      if (generation !== this.subGen) return;
      const existing = this.cache.get(identity);
      if (!existing) return;
      await db
        .update(encryptionKeyAnnouncements)
        .set({ fetchedAt })
        .where(eq(encryptionKeyAnnouncements.pubkey, identity));
      this.cache.set(identity, { ...existing, fetchedAt });
      return;
    }
    const latest = events.reduce((current, candidate) =>
      candidate.created_at > current.created_at ||
      (candidate.created_at === current.created_at && candidate.id < current.id)
        ? candidate
        : current,
    );
    await this.handleAnnouncement(latest, generation, fetchedAt);
  }

  private async handleAnnouncement(
    event: Event,
    generation = this.subGen,
    fetchedAt = Math.floor(Date.now() / 1000),
  ): Promise<void> {
    if (generation !== this.subGen) return;
    if (event.kind !== KIND_ENCRYPTION_KEY_ANNOUNCEMENT) return;
    const nTag = event.tags.find((t) => t[0] === 'n');
    if (!nTag || !nTag[1]) return;

    const identity = event.pubkey;
    await this.loadStoredAnnouncement(identity);
    const encryptionPubkey = nTag[1];
    const createdAt = event.created_at;

    const existing = this.cache.get(identity);
    if (
      existing &&
      (existing.createdAt > createdAt ||
        (existing.createdAt === createdAt && existing.eventId <= event.id))
    ) {
      await db
        .update(encryptionKeyAnnouncements)
        .set({ fetchedAt })
        .where(eq(encryptionKeyAnnouncements.pubkey, identity));
      this.cache.set(identity, { ...existing, fetchedAt });
      return;
    }

    this.cache.set(identity, { encryptionPubkey, createdAt, eventId: event.id, fetchedAt });
    await db
      .insert(encryptionKeyAnnouncements)
      .values({
        pubkey: identity,
        encryptionPubkey,
        eventId: event.id,
        eventCreatedAt: createdAt,
        rawEvent: event,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: encryptionKeyAnnouncements.pubkey,
        set: {
          encryptionPubkey,
          eventId: event.id,
          eventCreatedAt: createdAt,
          rawEvent: event,
          fetchedAt,
        },
      });
  }

  private async loadStoredAnnouncement(
    identity: string,
  ): Promise<EncryptionKeyAnnouncement | null> {
    const cached = this.cache.get(identity);
    if (cached || this.loadedFromDb.has(identity)) return cached ?? null;
    const active = this.dbLoads.get(identity);
    if (active) return active;
    const generation = this.subGen;
    const load = db
      .select({
        encryptionPubkey: encryptionKeyAnnouncements.encryptionPubkey,
        createdAt: encryptionKeyAnnouncements.eventCreatedAt,
        eventId: encryptionKeyAnnouncements.eventId,
        fetchedAt: encryptionKeyAnnouncements.fetchedAt,
      })
      .from(encryptionKeyAnnouncements)
      .where(eq(encryptionKeyAnnouncements.pubkey, identity))
      .get()
      .then((row) => {
        if (generation !== this.subGen) return null;
        this.loadedFromDb.add(identity);
        if (row) this.cache.set(identity, row);
        return row ?? null;
      });
    this.dbLoads.set(identity, load);
    try {
      return await load;
    } finally {
      if (this.dbLoads.get(identity) === load) this.dbLoads.delete(identity);
    }
  }
}

export const encryptionKeyWatcher = new EncryptionKeyWatcher();
