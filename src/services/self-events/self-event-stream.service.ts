import type { Event, Filter } from 'nostr-tools';

import { KIND_USER_EMOJI_LIST } from '@/lib/nostr/custom-emoji';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { platform } from '@/platform';

import { applyContactsEvent, CONTACTS_D } from '../contact/contact.service';
import { applyMutedEvent, MUTED_D } from '../conversation/conversation-prefs.service';
import {
  KIND_CLIENT_KEY_ANNOUNCEMENT,
  KIND_DM_RELAY_LIST,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_KEY_TRANSFER,
  KIND_RELAY_LIST_METADATA,
} from '../crypto/nip17-gift-wrap';
import { applyBlockedEvent, BLOCKED_D } from '../dm/block.service';
import { applyUserEmojiListEvent } from '../emoji/custom-emoji.service';
import {
  applyMediaServersEvent,
  KIND_BLOSSOM_SERVER_LIST,
} from '../files/media-server.service';
import type { SignAuth } from '../relay/managed-relay-pool';
import {
  applyOwnDmRelayListEvent,
  loadAccountDmRelays,
  loadAccountWriteRelays,
} from '../relay/relay-list.service';
import { relayPool } from '../relay/relay-pool';
import {
  getReplaceableEvent,
  storeReplaceableEvent,
} from '../relay/replaceable-events.service';
import type { Signer } from '../signer/signer.interface';

/** NIP-51 follow set — the kind carrying the private muted/contacts/blocked sets. */
const KIND_FOLLOW_SET = 30000;
/** All private-set d-tags the stream subscribes to. */
const PRIVATE_SET_D_TAGS = [MUTED_D, CONTACTS_D, BLOCKED_D];

/** 4454/4455 are only interesting while a sync exchange is live; matching the
 * previous key-sync subscription, the filters open at `now - this`. */
const KEY_SYNC_WINDOW_SECONDS = 300;
/** Cross-REQ/relay id dedup window. The managed pool already dedups per
 * subscription; this small LRU backstops duplicates across the fixed REQs. */
const SEEN_IDS_LIMIT = 500;

export type SelfEventHandlers = {
  /** Own 4454 client-key announcement (another device requesting key sync). */
  onKeyRequest: (event: Event) => void | Promise<void>;
  /** Own 4455 key transfer. */
  onKeyTransfer: (event: Event) => void;
  /** Own 10044 encryption-key announcement. */
  onKeyAnnouncement: (event: Event) => void;
  /** A newer own kind-10002/10050 arrived (another device edited our relay
   * lists) — the caller rebuilds its relay demand. */
  onOwnRelayListsChanged: () => void;
};

export type SelfEventStreamConfig = {
  accountPubkey: string;
  /** NIP-42 auth signer for relay reads — the same lazy signer dmService uses. */
  signAuth: SignAuth;
  /** Lazily builds the identity signer that decrypts the private 30000 sets.
   * Called on first use and cached; a rejection (e.g. account mid-teardown)
   * permanently skips the private sets for this session while the public lists
   * still apply — the same semantics as `syncPersonalConfigs`. */
  getSigner: () => Promise<Signer>;
  handlers: SelfEventHandlers;
};

/** Delivery lanes. Events sharing a lane are applied strictly one at a time. */
type Route =
  | 'key-request'
  | 'key-transfer'
  | 'key-announcement'
  | 'contacts'
  | 'muted'
  | 'blocked'
  | 'emoji'
  | 'media'
  | 'relay-lists';

function yieldToUi(): Promise<void> {
  // Some Android vendors suspend RN's Choreographer-backed timers in the
  // background. There is no frame to protect there, so keep the event lane
  // moving instead of stranding configuration updates behind setTimeout(0).
  if (platform.appState.currentState() !== 'active') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function dTagOf(event: Event): string {
  return event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
}

/** Normalize + dedup a relay list, dropping malformed entries instead of
 * failing the whole stream. All set arithmetic happens on normalized URLs. */
function normalizeSet(urls: string[]): Set<string> {
  const out = new Set<string>();
  for (const url of urls) {
    try {
      out.add(normalizeRelayUrl(url));
    } catch {
      // Skip malformed entries.
    }
  }
  return out;
}

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((url) => !b.has(url));
}

/**
 * The replaceable freshness rule: larger `created_at` wins; on a tie, the
 * smaller id wins. Used only by this dispatch layer's in-memory decisions —
 * `storeReplaceableEvent` (shared infrastructure) deliberately stays
 * first-seen-wins on `created_at >=` (an id comparison isn't worth its SQL
 * cost), so on a same-`created_at`/different-id tie this layer may forward a
 * version the store won't keep. Acceptable: the reconcilers are idempotent.
 */
function isReplaceableNewer(
  incoming: { created_at: number; id: string },
  current: { created_at: number; id: string },
): boolean {
  if (incoming.created_at !== current.created_at) {
    return incoming.created_at > current.created_at;
  }
  return incoming.id < current.id;
}

/**
 * The self-event dispatch layer: it owns the fixed set of long-lived REQs that
 * watch the **account's own non-message relay events** — key-sync requests and
 * transfers (4454/4455), encryption-key announcements (10044), the private
 * NIP-51 sets (30000 muted/contacts/blocked), the public lists (10030 emoji,
 * 10063 media servers), and the own relay lists (10002/10050) — and routes each
 * event to its service handler/reconciler.
 *
 * Deliberately out of scope (and owned elsewhere): kind-1059 gift wraps and
 * history backfill (dmService), temporary subscriptions, peers' events, and
 * the requester-side `KeySyncSession` transfer subscription.
 *
 * Lifecycle: `configure` (registration only) → `start` (resolves the relay
 * sets and opens the fixed REQs) → `destroy`. `start` is re-entrant: it closes
 * the previous subscriptions before opening new ones. dmService.init drives
 * the sequence, so a dmService re-init rebuilds this stream too.
 */
class SelfEventStream {
  private config: SelfEventStreamConfig | null = null;
  private unsubs: (() => void)[] = [];
  private subscriptionLabels: string[] = [];
  /** Bumped on every start/destroy so deliveries enqueued by a previous
   * session never run after it ended. */
  private session = 0;
  private seenIds = new Map<string, true>();
  /** Replaceable collapse: the newest version forwarded per address
   * (kind:pubkey:dTag), by the {@link isReplaceableNewer} rule. A relay pushes
   * the current version when the subscription opens — expected, not history
   * backfill. */
  private replaceableLatest = new Map<string, { createdAt: number; id: string }>();
  /** One promise chain per delivery lane: events in a lane are applied one at
   * a time, yielding to the UI between them; a throwing handler is isolated to
   * its lane. */
  private chains = new Map<Route, Promise<void>>();
  private signerPromise: Promise<Signer | null> | null = null;

  /** Register the account and handlers. Registration only — call before
   * `start` (ordering is guaranteed by dmService.init's sequential flow). */
  configure(config: SelfEventStreamConfig): void {
    this.config = config;
  }

  /** Resolve the relay sets and open the fixed REQ table. Re-entrant: closes
   * the previous subscriptions and resets the dispatch state first. */
  async start(): Promise<void> {
    const config = this.config;
    if (!config) throw new Error('SelfEventStream.start() called before configure()');
    this.closeSubscriptions();
    this.resetDispatchState();

    const [dmRelays, writeRelays] = await Promise.all([
      loadAccountDmRelays(config.accountPubkey),
      loadAccountWriteRelays(config.accountPubkey),
    ]);
    // A destroy/re-configure landing while the relay sets resolved must not
    // leave subscriptions behind for the stale session.
    if (this.config !== config) return;

    const dm = normalizeSet(dmRelays);
    const write = normalizeSet(writeRelays);
    const writeOnly = difference(write, dm);
    const discoveryOnly = difference(
      normalizeSet(DISCOVERY_RELAYS),
      new Set([...dm, ...write]),
    );

    const self = config.accountPubkey;
    const fiveMinAgo = Math.floor(Date.now() / 1000) - KEY_SYNC_WINDOW_SECONDS;
    const keySyncFilters: Filter[] = [
      { kinds: [KIND_CLIENT_KEY_ANNOUNCEMENT], authors: [self], since: fiveMinAgo },
      {
        kinds: [KIND_KEY_TRANSFER],
        authors: [self],
        '#p': [self],
        since: fiveMinAgo,
      },
    ];
    const ownListFilters: Filter[] = [
      { kinds: [KIND_FOLLOW_SET], authors: [self], '#d': [...PRIVATE_SET_D_TAGS] },
      { kinds: [KIND_USER_EMOJI_LIST], authors: [self] },
      { kinds: [KIND_BLOSSOM_SERVER_LIST], authors: [self] },
      { kinds: [KIND_RELAY_LIST_METADATA, KIND_DM_RELAY_LIST], authors: [self] },
    ];
    const keyAnnouncementFilter: Filter = {
      kinds: [KIND_ENCRYPTION_KEY_ANNOUNCEMENT],
      authors: [self],
    };

    // Capture the session so a late delivery from a just-closed subscription
    // (re-start unsubscribed it) can never reach the new session's handlers.
    const session = this.session;
    const onEvent = (event: Event) => {
      if (session !== this.session) return;
      this.dispatch(event);
    };
    const subscribe = (label: string, relays: string[], filters: Filter[]) => {
      if (relays.length === 0) return; // an empty relay set skips its REQ
      this.subscriptionLabels.push(label);
      this.unsubs.push(
        relayPool.subscribe({
          label,
          relays,
          filters,
          onEvent,
          signAuth: config.signAuth,
        }),
      );
    };

    subscribe('self.dm', [...dm], [keyAnnouncementFilter, ...keySyncFilters]);
    subscribe('self.write', writeOnly, [keyAnnouncementFilter, ...keySyncFilters, ...ownListFilters]);
    subscribe('self.discovery', discoveryOnly, [keyAnnouncementFilter, ...ownListFilters]);
  }

  /** Recovery polls may skip metadata refresh only while its live watchers work. */
  isHealthy(): boolean {
    return this.subscriptionLabels.length > 0 &&
      this.subscriptionLabels.every((label) => relayPool.hasHealthySubscription(label));
  }

  /** Close every subscription and clear all registration and dispatch state. */
  destroy(): void {
    this.closeSubscriptions();
    this.config = null;
    this.resetDispatchState();
  }

  private closeSubscriptions(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.subscriptionLabels = [];
  }

  private resetDispatchState(): void {
    this.session++;
    this.seenIds.clear();
    this.replaceableLatest.clear();
    this.chains.clear();
    this.signerPromise = null;
  }

  private dispatch(event: Event): void {
    const config = this.config;
    if (!config) return;
    if (this.seenIds.has(event.id)) return;
    this.rememberId(event.id);

    switch (event.kind) {
      case KIND_CLIENT_KEY_ANNOUNCEMENT:
        this.enqueue('key-request', () => config.handlers.onKeyRequest(event));
        return;
      case KIND_KEY_TRANSFER:
        this.enqueue('key-transfer', () => config.handlers.onKeyTransfer(event));
        return;
      case KIND_ENCRYPTION_KEY_ANNOUNCEMENT:
        if (!this.isNewerReplaceable(event)) return;
        // A new key must stop message intake before another event can decrypt
        // with the old key. This control signal cannot wait behind a UI yield.
        config.handlers.onKeyAnnouncement(event);
        return;
      case KIND_FOLLOW_SET:
        this.dispatchFollowSet(config, event);
        return;
      case KIND_USER_EMOJI_LIST:
        if (!this.isNewerReplaceable(event)) return;
        this.storeReplaceable(event);
        this.enqueue('emoji', () => applyUserEmojiListEvent(config.accountPubkey, event));
        return;
      case KIND_BLOSSOM_SERVER_LIST:
        if (!this.isNewerReplaceable(event)) return;
        this.storeReplaceable(event);
        this.enqueue('media', () => applyMediaServersEvent(config.accountPubkey, event));
        return;
      case KIND_RELAY_LIST_METADATA:
        this.dispatchRelayListMetadata(config, event);
        return;
      case KIND_DM_RELAY_LIST:
        this.dispatchOwnDmRelayList(config, event);
        return;
    }
  }

  /** 30000 private sets, split by d-tag into their domain lanes. */
  private dispatchFollowSet(config: SelfEventStreamConfig, event: Event): void {
    const dTag = dTagOf(event);
    const route: Route | null =
      dTag === CONTACTS_D
        ? 'contacts'
        : dTag === MUTED_D
          ? 'muted'
          : dTag === BLOCKED_D
            ? 'blocked'
            : null;
    if (!route) return;
    if (!this.isNewerReplaceable(event)) return;
    this.storeReplaceable(event);
    const apply =
      route === 'contacts'
        ? applyContactsEvent
        : route === 'muted'
          ? applyMutedEvent
          : applyBlockedEvent;
    this.enqueue(route, async () => {
      const signer = await this.loadSigner(config);
      if (!signer) return; // no identity key available: skip private sets only
      await apply(config.accountPubkey, event, signer);
    });
  }

  /**
   * Own NIP-65 list: persist it, and notify only when it's newer than the
   * **stored** row. Comparing against storage (not a subscribe-time baseline)
   * covers the offline-change case: if another device edited our 10002 while
   * we were away, the local cache may still be within its TTL (so `start` even
   * built the REQs from a stale write list), and the version pushed when the
   * subscription opens IS the new one — it must trigger a rebuild right away.
   * No stored row also notifies: the write list was a discovery fallback, so a
   * real 10002 existing at all is worth rebuilding for. The echo of our own
   * local publish (same `created_at`, same id) never notifies, which prevents
   * a publish → notify → re-init → echo loop. The storage read is async, so
   * the whole flow runs inside the lane task.
   */
  private dispatchRelayListMetadata(config: SelfEventStreamConfig, event: Event): void {
    if (!this.isNewerReplaceable(event)) return;
    this.enqueue('relay-lists', async () => {
      const prev = await getReplaceableEvent({
        pubkey: config.accountPubkey,
        kind: KIND_RELAY_LIST_METADATA,
      });
      const newer = !prev || isReplaceableNewer(event, prev);
      await storeReplaceableEvent(event).catch(() => {});
      if (newer) config.handlers.onOwnRelayListsChanged();
    });
  }

  /** Own DM relay list: persist, mirror into the local `relay_lists` table
   * (newest-wins), and notify only when the table actually changed. */
  private dispatchOwnDmRelayList(config: SelfEventStreamConfig, event: Event): void {
    if (!this.isNewerReplaceable(event)) return;
    this.storeReplaceable(event);
    this.enqueue('relay-lists', async () => {
      const updated = await applyOwnDmRelayListEvent(config.accountPubkey, event);
      if (updated) config.handlers.onOwnRelayListsChanged();
    });
  }

  /** Replaceable collapse: forward only a newer version per address, by the
   * {@link isReplaceableNewer} rule (created_at desc, id asc on ties). */
  private isNewerReplaceable(event: Event): boolean {
    const address = `${event.kind}:${event.pubkey}:${dTagOf(event)}`;
    const latest = this.replaceableLatest.get(address);
    if (
      latest &&
      !isReplaceableNewer(event, { created_at: latest.createdAt, id: latest.id })
    ) {
      return false;
    }
    this.replaceableLatest.set(address, { createdAt: event.created_at, id: event.id });
    return true;
  }

  private storeReplaceable(event: Event): void {
    // Fire-and-forget: the store itself is newest-wins.
    void storeReplaceableEvent(event).catch(() => {});
  }

  /** Lazily resolve (and cache) the identity signer that decrypts the private
   * sets. A failure is sticky for the session: private sets are skipped while
   * public lists keep applying. */
  private loadSigner(config: SelfEventStreamConfig): Promise<Signer | null> {
    this.signerPromise ??= config.getSigner().catch(() => null);
    return this.signerPromise;
  }

  /** Serialize one event onto its lane: lanes run independently, events within
   * a lane run one at a time with a UI yield in between, and a throwing
   * handler never breaks its own or any other lane. */
  private enqueue(route: Route, task: () => void | Promise<void>): void {
    const session = this.session;
    const prev = this.chains.get(route) ?? Promise.resolve();
    const next = prev.then(async () => {
      if (session !== this.session) return; // destroyed/restarted meanwhile
      await yieldToUi();
      if (session !== this.session) return;
      try {
        await task();
      } catch (error) {
        console.warn(`[self-events] ${route} handler failed`, error);
      }
    });
    this.chains.set(route, next);
  }

  private rememberId(id: string): void {
    if (this.seenIds.size >= SEEN_IDS_LIMIT) {
      const oldest = this.seenIds.keys().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    this.seenIds.set(id, true);
  }
}

export const selfEventStream = new SelfEventStream();
