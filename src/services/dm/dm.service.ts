import { and, asc, count, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { Event, EventTemplate } from 'nostr-tools';

import { db } from '@/db/client';
import {
  contacts,
  conversations,
  messageDeliveries,
  messages,
  outbox,
  peerDmInfo,
} from '@/db/schema';
import type {
  DeliveryCopyRecord,
  DeliveryRelayRecord,
} from '@/db/schema/message-deliveries';
import type { Rumor } from '@/db/schema/types';
import { platform } from '@/platform';
import { deriveConversationKey } from '@/lib/nostr/conversation-key';
import { buildEmojiTag, type CustomEmoji } from '@/lib/nostr/custom-emoji';
import { messageOrderAt, withMessageOrderTag } from '@/lib/nostr/message-order';
import { normalizeBareNostrUris } from '@/lib/nostr/normalize-content';
import {
  createPerfSpan,
  profileAsync,
  profileSync,
  type PerfSpan,
} from '@/lib/perf/profiler';
import { getPTags, getReplyToId, getSubject } from '@/lib/nostr/tags';

import {
  buildRumor,
  createGiftWrappedMessage,
  KIND_CHAT,
  KIND_FILE,
  KIND_GIFT_WRAP,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_KEY_TRANSFER,
  KIND_REACTION,
  unwrapGiftWrapWithKeys,
  type SignSeal,
} from '../crypto/nip17-gift-wrap';
import { nextRumorTimestamp, type RumorTimestamp } from './rumor-clock';
import { buildSigner } from '../account/account.service';
import {
  recordAttachmentMedia,
  recordEmbeddedMedia,
} from '../files/media-index.service';
import {
  deleteConversationAttachments,
} from '../files/file-attachment.service';
import {
  fetchDmRelays,
  loadAccountDmRelays,
  ownKeyTransferRelays,
} from '../relay/relay-list.service';
import { RelayQueryError } from '../relay/relay-query-error';
import { relayPool } from '../relay/relay-pool';
import { capDeliveryRelays } from '../relay/relay-router';
import { selfEventStream } from '../self-events/self-event-stream.service';
import { deliveryStatusStore, surfacedCopies } from './delivery-status';
import { syncStatusStore } from './sync-status';
import type { Signer } from '../signer/signer.interface';
import { isBlocked, loadBlockedIntoCache } from './block.service';

import { mergeStoredMessageIntoTail } from '../conversation/message-tail-cache';
import { encryptionKeyWatcher } from './encryption-key-watcher';
import {
  getClientPubkeyFromEvent,
  getEncryptionPubkeyFromEvent,
  getKeySyncRelayHints,
  loadEncryptionKeys,
  type EncryptionKeypair,
} from './encryption-key.service';
import {
  getSyncCursor,
  isGiftWrapProcessed,
  isSyncRequestProcessed,
  markGiftWrapProcessed,
  markSyncRequestProcessed as persistSyncRequestProcessed,
  setBackwardUntil,
  setForwardSince,
} from './sync-store';
import { isActiveConversationVisible } from './active-conversation';
import { receiveSessionStore } from './receive-session';
import { pollRecentGiftWraps } from './notification-poll';
import { waitForMessagingSendReadiness } from './messaging-send-readiness';
import {
  isNewerAnnouncement,
  MessagingKeySyncRequiredError,
  resolveMessagingMetadata,
  type MessagingMetadata,
} from './messaging-metadata';

const OUTBOX_SENT_CLEANUP_MS = 3000;
/** Per-relay publish timeout for outgoing messages (jumble uses the same). */
const PUBLISH_TIMEOUT_MS = 10_000;

/** The live tail opens at `now - this`, so a new gift wrap whose `created_at` was
 * randomized up to 2 days into the past (NIP-59) is still caught live. The
 * re-received overlap is cheap — already-seen ids skip decryption. */
const FORWARD_OVERLAP_SECONDS = 2 * 24 * 60 * 60 + 60 * 60; // 2 days + 1h margin
/** History backfill page size (per relay, per round). */
const BACKFILL_PAGE = 200;
/** Backfill round query timeout. */
const BACKFILL_QUERY_TIMEOUT_MS = 8000;
/** `backwardUntil` sentinel meaning history is fully backfilled. */
const BACKFILL_DONE = 0;
function yieldToUi(): Promise<void> {
  // There is no frame to protect while backgrounded, and some Android vendors
  // suspend RN timers there. Waiting for setTimeout(0) would strand the live
  // gift-wrap drain after its first message until the app returns.
  if (platform.appState.currentState() !== 'active') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Cap on the live "which relays delivered this gift wrap" map. Crossing it
 * triggers a prune of entries older than {@link GIFT_WRAP_SEEN_MAX_AGE_MS}.
 * Gift-wrap-only, so live use never approaches it; a big backfill does, and the
 * age prune keeps it bounded. */
const GIFT_WRAP_SEEN_LIMIT = 2000;
/** A gift wrap's source-relay record older than this may be pruned. Generous
 * vs. the seconds-long window in which a peer's relays redeliver a live wrap, so
 * the union for a still-fresh message is never dropped mid-collection. */
const GIFT_WRAP_SEEN_MAX_AGE_MS = 60_000;

/**
 * A message counts as delivered by **majority**: at least half the recipient
 * relays accepted it (and at least one did). We deliberately don't require every
 * relay — a single unreachable relay shouldn't flag an otherwise-fine send.
 */
function isDelivered(okCount: number, total: number): boolean {
  return okCount > 0 && okCount * 2 >= total;
}

/** The read watermark as an `(order_at, id)` cursor — the same key the message
 * list uses. Legacy messages share a second-floor `order_at` and tie on id. */
type ReadCursor = { orderAt: number; id: string };

/** The larger of two cursors by `(at, id)`, or whichever is non-null. */
function maxCursor(a: ReadCursor | null, b: ReadCursor | null): ReadCursor | null {
  if (!a) return b;
  if (!b) return a;
  if (a.orderAt !== b.orderAt) return a.orderAt > b.orderAt ? a : b;
  return a.id >= b.id ? a : b;
}

/** SQL predicate: a message is strictly after the `(order_at, id)` cursor. */
function unreadAfterCursor(c: ReadCursor) {
  if (!c.id) return gt(messages.orderAt, c.orderAt);
  return or(
    gt(messages.orderAt, c.orderAt),
    and(eq(messages.orderAt, c.orderAt), gt(messages.id, c.id)),
  );
}

/** Stored `unreadCount` never exceeds this — once a conversation hits it the
 * badge reads "99+", so there's no point counting (or storing) further. The
 * count query is bounded by it too, so a huge unread tail is never scanned. */
const UNREAD_CAP = 100;

/** The unread set: kind-14/15 messages in this account's view of the
 * conversation after `cursor` (or all of them when nothing's been read). */
function unreadWhere(accountPubkey: string, conversationKey: string, cursor: ReadCursor | null) {
  const base = and(
    eq(messages.accountPubkey, accountPubkey),
    eq(messages.conversationKey, conversationKey),
    inArray(messages.kind, [14, 15]),
  );
  return cursor ? and(base, unreadAfterCursor(cursor)) : base;
}

/** Count the unread set, capped at {@link UNREAD_CAP} (a `LIMIT`ed subquery, so
 * the scan stops there). `exec` is `db` or a transaction — both share `select`. */
async function countUnreadCapped(
  exec: Pick<typeof db, 'select'>,
  accountPubkey: string,
  conversationKey: string,
  cursor: ReadCursor | null,
  profile?: PerfSpan | null,
): Promise<number> {
  return profileAsync(profile, 'db.countUnread', async () => {
    const sub = exec
      .select({ one: sql`1`.as('one') })
      .from(messages)
      .where(unreadWhere(accountPubkey, conversationKey, cursor))
      .limit(UNREAD_CAP)
      .as('u');
    return (await exec.select({ n: count() }).from(sub).get())?.n ?? 0;
  });
}

export type SendMessageOpts = {
  accountPubkey: string;
  /** Unused by the text path — the service uses its own initialized
   * `encryptionKeypair`. Optional so callers needn't read it from SecureStore
   * on every send (that read added latency before the optimistic bubble). */
  encryptionKeypair?: EncryptionKeypair;
  recipientPubkeys: string[];
  content: string;
  extraTags?: string[][];
  replyToId?: string;  subject?: string;
  /** Timestamp captured by the UI so the optimistic row and rumor agree. */
  timestamp?: RumorTimestamp;
};

export type SendReactionOpts = {
  accountPubkey: string;
  encryptionKeypair: EncryptionKeypair;
  recipientPubkeys: string[];
  targetMessageId: string;
  emoji: string | CustomEmoji;
};

export type DmServiceListener = {
  onNewMessage?: (rumor: Rumor) => void;
};

class DmService {
  private accountPubkey: string | null = null;
  /** The account's encryption keys, newest-first (`[0]` = current). Loaded from
   * SecureStore on init. Encrypt/announce with `[0]`; decrypt tries the whole
   * list so messages a peer encrypted to a key we've since rotated away from
   * still decrypt. */
  private encryptionKeys: EncryptionKeypair[] = [];
  /** The current encryption key (newest), or null if none — a read-only view of
   * `encryptionKeys[0]` so the send/guard paths read it unchanged. */
  private get encryptionKeypair(): EncryptionKeypair | null {
    return this.encryptionKeys[0] ?? null;
  }
  private dmRelays: string[] = [];
  /** Own DM ∪ write relays for 4454/4455 multi-device key transfer. */
  private keyTransferRelays: string[] = [];
  private dmLiveSubUnsub: (() => void) | null = null;
  /** Pending debounce for rebuilding every REQ after another device changed
   * our own 10002/10050 relay lists (see `scheduleRelayListReinit`). */
  private relayListReinitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock anchor shared by the live tail and this session's backfill. */
  private subscribedAt = 0;
  private listeners = new Set<DmServiceListener>();
  /** Owned by long-lived UI (the app shell); NOT cleared on destroy. */
  private syncRequestListeners = new Set<(event: Event) => void>();
  private keyTransferListeners = new Set<(event: Event) => void>();
  /** Requester client keys with a recently observed 4455. This short-lived
   * cache handles relay delivery reordering: a fulfilled 4454 must not open an
   * approval prompt when it arrives after its response. */
  private fulfilledSyncRequestClients = new Set<string>();
  private encryptionKeyChangedListeners = new Set<(newPubkey: string) => void>();
  /** Tracks which conversation the user is currently looking at, so incoming
   * messages for it don't bump unreadCount. */
  private activeConversation: { accountPubkey: string; conversationKey: string } | null = null;
  /** Incoming gift wraps are processed through this queue rather than all at
   * once. On (re)connect a relay replays the whole history matching the
   * subscription; decrypting every one (NIP-44, synchronous CPU) back-to-back
   * would freeze the JS thread — taps queue up and then all fire at once. The
   * queue decrypts in small batches and yields between them so the UI stays
   * responsive during the replay burst. */
  private giftWrapQueue: Event[] = [];
  private drainingGiftWraps = false;
  /** Gift-wrap jobs that have crossed an async boundary. Account removal waits
   * for this set after invalidating the session so no stale write can race the
   * deletion of that account's rows. */
  private inFlightGiftWrapTasks = new Set<Promise<Rumor | null>>();
  /** Which relays delivered each incoming gift wrap this session, keyed by the
   * **gift wrap** id (what `receivedEvent` reports — the wrap isn't decrypted
   * yet). Populated for every relay delivery (not just the first), so the source
   * relays can be a true union. `rumorId` is filled once the wrap is decrypted +
   * stored, bridging to the message row id the UI looks up by. Bounded by
   * {@link GIFT_WRAP_SEEN_LIMIT} + age prune; replaces nostr-tools' unbounded,
   * pool-wide `seenOn`. */
  private giftWrapSeenOn = new Map<
    string,
    { relays: Set<string>; at: number; rumorId?: string }
  >();
  /** rumor id → gift wrap id, so the message-info drawer can look up the live
   * source-relay union by the row id it has. Pruned alongside `giftWrapSeenOn`. */
  private rumorToGiftWrap = new Map<string, string>();
  /** Signs NIP-42 auth for relay reads (subscribe/backfill query). */
  private signAuth: ((authEvt: EventTemplate) => Promise<Event>) | null = null;
  /** Signs a seal (kind 13) with the identity key, so the recipient can verify
   * the rumor's claimed author. Same identity signer as `signAuth`. */
  private signSeal: SignSeal | null = null;
  /** Bumped on every init/destroy so an in-flight backfill loop from a previous
   * account/session detects it's stale and stops. */
  private syncEpoch = 0;
  private receiveAbort: AbortController | null = null;
  private initializing = false;
  /** Only a complete backfill plus uninterrupted live intake can replace a recovery poll. */
  private historyBackfillComplete = false;
  private historyBackfillTask: Promise<void> | null = null;
  private removeHistoryAppStateListener: (() => void) | null = null;
  private removeUserReturnedListener: (() => void) | null = null;
  private liveCoverageBroken = false;
  private liveStatus: 'connecting' | 'degraded' | 'connected' | null = null;
  private notificationPolls = new Set<AbortController>();
  private latestKeyAnnouncement: Event | null = null;

  /** Startup exposes local conversations before network messaging is ready.
   * Keep an optimistic send pending across that short window, then re-check the
   * live session after the account-level preparation signal resolves. */
  private waitUntilSendReady(accountPubkey: string): Promise<void> | null {
    if (this.accountPubkey === accountPubkey && this.encryptionKeypair && this.signSeal) return null;
    return waitForMessagingSendReadiness(accountPubkey).then(() => {
      if (this.accountPubkey !== accountPubkey || !this.encryptionKeypair || !this.signSeal) {
        throw new Error('DM service not initialized for this account');
      }
    });
  }

  async init(opts: {
    accountPubkey: string;
    dmRelays: string[];
    metadata?: MessagingMetadata;
    /** A just-created local identity has no history before its first live session. */
    skipInitialHistory?: boolean;
    abort?: AbortSignal;
  }): Promise<void> {
    const profile = createPerfSpan('dm.init', { relays: opts.dmRelays.length });
    this.destroy();

    const epoch = this.syncEpoch;
    const controller = new AbortController();
    this.receiveAbort = controller;
    this.initializing = true;
    const cancel = () => {
      if (this.syncEpoch === epoch) this.destroy();
    };
    opts.abort?.addEventListener('abort', cancel, { once: true });
    let keySyncRequired: string | null = null;
    const checkCurrent = () => {
      if (keySyncRequired) throw new MessagingKeySyncRequiredError(keySyncRequired);
      if (opts.abort?.aborted || controller.signal.aborted || this.syncEpoch !== epoch) {
        throw new Error('Messaging initialization was cancelled.');
      }
    };
    let signerPromise: Promise<Signer> | null = null;
    const signWithIdentity: SignSeal = (template) => {
      signerPromise ??= buildSigner(opts.accountPubkey);
      return signerPromise.then((signer) => signer.signEvent(template));
    };
    try {
      checkCurrent();
      const metadata = opts.metadata ?? await resolveMessagingMetadata(opts.accountPubkey, {
        signAuth: signWithIdentity,
        abort: controller.signal,
      });
      checkCurrent();
      if (metadata.accountPubkey !== opts.accountPubkey) throw new Error('Messaging account mismatch.');
      const keys = await loadEncryptionKeys(opts.accountPubkey);
      checkCurrent();
      const remote = metadata.announcement && getEncryptionPubkeyFromEvent(metadata.announcement);
      if (remote && !keys.some((key) => key.pubkey === remote)) {
        this.pauseForKeySync(opts.accountPubkey, remote);
        throw new MessagingKeySyncRequiredError(remote);
      }
      if (keys.length === 0) throw new Error('No messaging encryption key is available.');
      this.accountPubkey = opts.accountPubkey;
      this.encryptionKeys = keys;
      this.latestKeyAnnouncement = metadata.announcement;
      this.dmRelays = metadata.dmRelays;
      // Seed the block-list mirror before the incoming subscription opens, so a
      // blocked sender's gift wraps are dropped from the very first delivery.
      await profileAsync(profile, 'db.loadBlockedIntoCache', () =>
        loadBlockedIntoCache(opts.accountPubkey),
      );
      // Key transfers use the account's DM and write relays.
      checkCurrent();
      const keyTransferRelays = await profileAsync(profile, 'db.loadKeyRelays', () =>
        ownKeyTransferRelays(opts.accountPubkey),
      );

      checkCurrent();
      this.keyTransferRelays = keyTransferRelays;
      await profileAsync(profile, 'watcher.init', () =>
        encryptionKeyWatcher.init({ dmRelays: this.dmRelays }),
      );

      checkCurrent();
      this.subscribedAt = Math.floor(Date.now() / 1000);

      this.signAuth = signWithIdentity;
      this.signSeal = signWithIdentity;
      const signAuth = signWithIdentity;

      // The self-event stream owns every long-lived REQ watching our own
      // non-message events (4454/4455 key sync, 10044 rotation, the 30000 private
      // sets, 10030/10063 public lists, own 10002/10050 relay lists) and routes
      // them back into this service's handlers or the domain reconcilers. This
      // service keeps only the gift-wrap tail + history backfill.
      selfEventStream.configure({
        accountPubkey: opts.accountPubkey,
        signAuth,
        getSigner: () => {
          signerPromise ??= buildSigner(opts.accountPubkey);
          return signerPromise;
        },
        handlers: {
          onKeyRequest: (event) => this.handleClientKeyAnnouncement(event),
          onKeyTransfer: (event) => this.handleKeyTransfer(event),
          onKeyAnnouncement: (event) => {
            keySyncRequired = this.handleEncryptionKeyAnnouncement(event);
          },
          onOwnRelayListsChanged: () => this.scheduleRelayListReinit(),
        },
      });
      await profileAsync(profile, 'relay.startSelfEventStream', () => selfEventStream.start());
      checkCurrent();

      // The live tail only needs *new* wraps, not the whole history nor the gap
      // since we were last open — both are the paged backfill's job (a relay caps
      // each filter at `limit`, so a `since`-only sub can't be trusted to backfill
      // a large gap). It opens at a fixed `now - overlap` window: just enough to
      // catch a "new" wrap whose NIP-59 `created_at` was randomized into the recent
      // past. The re-received overlap is cheap — already-seen ids skip decryption.
      const since = Math.max(0, this.subscribedAt - FORWARD_OVERLAP_SECONDS);

      this.dmLiveSubUnsub = profileSync(profile, 'relay.subscribeDmLive', () =>
        relayPool.subscribe({
          label: 'dm.live',
          relays: this.dmRelays,
          filters: [{ kinds: [KIND_GIFT_WRAP], '#p': [opts.accountPubkey], since }],
          onEvent: (event, relayUrl) => {
            if (this.syncEpoch !== epoch) return;
            this.recordGiftWrapSeen(event.id, relayUrl);
            this.enqueueGiftWrap(event);
          },
          // The first gift-wrap delivery is recorded in onEvent. Later
          // cross-relay duplicates are deduped before onEvent, so use the
          // already-created entry to grow their exact source-relay union.
          onReceived: (relayUrl, id) => {
            if (this.giftWrapSeenOn.has(id)) this.recordGiftWrapSeen(id, relayUrl);
          },
          // Socket/subscription health, not EOSE, drives the connection label. The
          // managed pool moves back to `connecting` when every physical relay
          // subscription is down and restores it after any relay recovers.
          onStatusChange: (status) => {
            if (this.syncEpoch === epoch) {
              if (this.liveStatus !== null && this.liveStatus !== 'connecting' && status !== 'connected') {
                this.liveCoverageBroken = true;
              }
              this.liveStatus = status;
              syncStatusStore.getState().setConnected(status !== 'connecting');
            }
          },
          signAuth,
        }),
      );

      checkCurrent();
      // Only foreground entry may start a history pass. Background routing/key
      // reinitialization still restores live intake without starting history.
      let previousState = platform.appState.currentState();
      this.removeHistoryAppStateListener = platform.appState.addChangeListener((state) => {
        const enteredForeground = state === 'active' && previousState !== 'active';
        previousState = state;
        if (enteredForeground && this.syncEpoch === epoch) this.startHistoryBackfill();
      });
      this.removeUserReturnedListener = platform.notifications.addUserReturnedListener(() => {
        if (this.syncEpoch !== epoch) return;
        const active = this.activeConversation;
        if (active?.accountPubkey === opts.accountPubkey) {
          void this.markConversationAsRead(active.accountPubkey, active.conversationKey).catch(
            (error) => console.warn('[dm] Failed to mark the active conversation as read.', error),
          );
        }
      });
      if (!opts.skipInitialHistory) this.startHistoryBackfill();
      receiveSessionStore.setState({ status: 'ready', accountPubkey: opts.accountPubkey }, true);
    } catch (error) {
      if (this.syncEpoch === epoch) this.destroy();
      throw error;
    } finally {
      opts.abort?.removeEventListener('abort', cancel);
      if (this.syncEpoch === epoch) this.initializing = false;
      profile?.end();
    }
  }

  destroy(): void {
    if (receiveSessionStore.getState().status !== 'key-required') {
      receiveSessionStore.setState({ status: 'stopped', accountPubkey: null }, true);
    }
    for (const controller of this.notificationPolls) controller.abort();
    this.notificationPolls.clear();
    this.receiveAbort?.abort();
    this.receiveAbort = null;
    this.initializing = false;
    this.removeHistoryAppStateListener?.();
    this.removeHistoryAppStateListener = null;
    this.removeUserReturnedListener?.();
    this.removeUserReturnedListener = null;
    this.historyBackfillTask = null;
    this.historyBackfillComplete = false;
    this.liveCoverageBroken = false;
    this.liveStatus = null;
    this.latestKeyAnnouncement = null;
    this.dmLiveSubUnsub?.();
    this.dmLiveSubUnsub = null;
    selfEventStream.destroy();
    if (this.relayListReinitTimer) {
      clearTimeout(this.relayListReinitTimer);
      this.relayListReinitTimer = null;
    }
    this.giftWrapQueue = [];
    this.giftWrapSeenOn.clear();
    this.rumorToGiftWrap.clear();
    this.signAuth = null;
    this.signSeal = null;
    this.fulfilledSyncRequestClients.clear();
    // Invalidate any in-flight backfill loop (it checks the epoch each round).
    this.syncEpoch++;
    // Back to "connecting" for the next account/session (no live subs now).
    syncStatusStore.getState().reset();
    encryptionKeyWatcher.destroy();
    this.accountPubkey = null;
    this.encryptionKeys = [];
    this.dmRelays = [];
    this.keyTransferRelays = [];
  }

  /** Invalidate the session immediately, then wait only for already-started
   * gift-wrap writes to settle. Used before destructive account-data removal;
   * ordinary account switches remain synchronous and rely on epoch guards. */
  async destroyAndWaitForWrites(): Promise<void> {
    this.destroy();
    while (this.inFlightGiftWrapTasks.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightGiftWrapTasks));
    }
  }

  /** Register a listener for incoming Key Transfer requests (kind 4454 from
   * another of the user's devices). Owned by the app shell. */
  onSyncRequest(fn: (event: Event) => void): () => void {
    this.syncRequestListeners.add(fn);
    return () => this.syncRequestListeners.delete(fn);
  }

  /** Register a listener for a 4455 emitted by one of this account's devices.
   * The recipient device alone can decrypt it; other devices use its routed
   * client key only to withdraw their redundant approval prompt. */
  onKeyTransfer(fn: (event: Event) => void): () => void {
    this.keyTransferListeners.add(fn);
    return () => this.keyTransferListeners.delete(fn);
  }

  /**
   * Watches the requester's advertised return relays while an approval is
   * visible. A responding device publishes there as well as to its own DM and
   * write relays, so this lets another approving device withdraw its prompt
   * even when its local relay lists differ from the responder's.
   */
  watchSyncRequestResolution(request: Event): () => void {
    const accountPubkey = this.accountPubkey;
    const clientPubkey = getClientPubkeyFromEvent(request);
    if (!accountPubkey || !clientPubkey) return () => {};

    const relays = Array.from(
      new Set([...this.keyTransferRelays, ...getKeySyncRelayHints(request)]),
    );
    if (relays.length === 0) return () => {};

    return relayPool.subscribe({
      label: 'key-transfer-resolution',
      relays,
      filter: {
        kinds: [KIND_KEY_TRANSFER],
        authors: [accountPubkey],
        '#p': [clientPubkey],
      },
      onEvent: (event) => this.handleKeyTransfer(event),
      signAuth: this.signAuth ?? undefined,
    });
  }

  /** Register a listener for encryption-key rotation observed on another device. */
  onEncryptionKeyChanged(fn: (newPubkey: string) => void): () => void {
    this.encryptionKeyChangedListeners.add(fn);
    return () => this.encryptionKeyChangedListeners.delete(fn);
  }

  /** Remember a handled 4454 id so its approval prompt doesn't re-fire. */
  async markSyncRequestProcessed(eventId: string): Promise<void> {
    if (!this.accountPubkey) return;
    await persistSyncRequestProcessed(this.accountPubkey, eventId);
  }

  addListener(listener: DmServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The account this service is currently bound to (null before init / after
   * destroy). Lets the notification listener attribute a live rumor without
   * re-reading the active-account store. */
  getAccountPubkey(): string | null {
    return this.accountPubkey;
  }

  setActiveConversation(accountPubkey: string, conversationKey: string): void {
    this.activeConversation = { accountPubkey, conversationKey };
  }

  /**
   * Warm the DM-relay-list cache for a conversation's counterparties when the
   * chat opens, so the send path reads only local data (the recipient's
   * encryption key is already kept warm by `encryptionKeyWatcher.watch`). Result
   * is cached in relay-list.service; this is fire-and-forget.
   */
  prefetchCounterpartyRelays(pubkeys: string[]): void {
    for (const p of pubkeys) {
      void fetchDmRelays({ pubkey: p, searchRelays: this.dmRelays }).catch(() => {});
    }
  }

  /**
   * Whether we can deliver a NIP-17 DM to `pubkey` right now. Both pieces are
   * required: an encryption key (kind 10044, to encrypt to) AND at least one DM
   * inbox relay (kind 10050, to deliver to — the recipient doesn't read ours).
   * Missing either makes the contact literally unreachable, so the chat screen
   * gates the composer on this instead of letting a send fail silently. Lookups
   * are cache-first (kept warm by `watch()` / `prefetchCounterpartyRelays`), so
   * an established conversation answers from local state.
   */
  async checkDmSupport(
    pubkey: string,
    opts?: { force?: boolean; onRelayQuery?: () => void },
  ): Promise<{ encryptionKey: boolean; relays: boolean }> {
    // Note-to-self: we obviously support ourselves (our own key + relays are
    // local), so resolve instantly without a relay round-trip.
    if (pubkey === this.accountPubkey) {
      return { encryptionKey: true, relays: true };
    }
    const [encKey, relays] = await Promise.all([
      opts?.force
        ? encryptionKeyWatcher.forceRefresh(pubkey, opts.onRelayQuery)
        : encryptionKeyWatcher.resolve(pubkey, opts?.onRelayQuery),
      fetchDmRelays({
        pubkey,
        searchRelays: this.dmRelays,
        force: opts?.force,
        onRelayQuery: opts?.onRelayQuery,
      }),
    ]);
    // A reachable peer (both pieces present) is **persisted** — encryption
    // pubkey + DM relays + check time — so the next open can answer from the
    // local database (across restarts) without a "Checking…" flash. An unreachable
    // peer keeps **no row** (and we drop any stale one), so it's re-checked every
    // open — the moment they publish the missing piece, the next open catches it.
    if (encKey && relays.length > 0) {
      const set = {
        encryptionPubkey: encKey,
        dmRelays: relays,
        checkedAt: Math.floor(Date.now() / 1000),
      };
      await db
        .insert(peerDmInfo)
        .values({ pubkey, ...set })
        .onConflictDoUpdate({ target: peerDmInfo.pubkey, set })
        .catch(() => {});
    } else {
      await db.delete(peerDmInfo).where(eq(peerDmInfo.pubkey, pubkey)).catch(() => {});
    }
    return { encryptionKey: !!encKey, relays: relays.length > 0 };
  }

  /**
   * Local DM-support verdict from the persisted {@link peerDmInfo} row.
   * A row exists **only for a reachable peer** (both pieces present), so its
   * presence *is* the `ready` verdict; `null` means unreachable-or-never-checked,
   * which the composer treats as "must check" (quietly reads local caches, then
   * shows "Checking…" only if it queries relays). `at` (ms) drives the TTL.
   * Self is always reachable.
   */
  async getCachedDmSupport(
    pubkey: string,
  ): Promise<{ encryptionKey: boolean; relays: boolean; at: number } | null> {
    if (pubkey === this.accountPubkey) {
      return { encryptionKey: true, relays: true, at: Date.now() };
    }
    const row = await db
      .select({ checkedAt: peerDmInfo.checkedAt })
      .from(peerDmInfo)
      .where(eq(peerDmInfo.pubkey, pubkey))
      .get();
    if (!row) return null;
    return { encryptionKey: true, relays: true, at: row.checkedAt * 1000 };
  }

  clearActiveConversation(): void {
    this.activeConversation = null;
  }

  /** Zero out unreadCount and advance the read cursor to the newest message. */
  async markConversationAsRead(
    accountPubkey: string,
    conversationKey: string,
  ): Promise<void> {
    const newest = await db
      .select({ id: messages.id, createdAt: messages.createdAt, orderAt: messages.orderAt })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, accountPubkey),
          eq(messages.conversationKey, conversationKey),
          inArray(messages.kind, [14, 15]),
        ),
      )
      .orderBy(desc(messages.orderAt), desc(messages.id))
      .limit(1);
    await db
      .update(conversations)
      .set({
        unreadCount: 0,
        // Fall back to now only if the conversation somehow has no real message.
        lastReadAt: newest[0]?.createdAt ?? Math.floor(Date.now() / 1000),
        lastReadOrderAt: newest[0]?.orderAt ?? Date.now(),
        lastReadMessageId: newest[0]?.id ?? null,
      })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      );
  }

  /**
   * Capture the unread boundary for the "unread messages" divider, then mark the
   * conversation read — in one call, because opening a chat marks it read (which
   * advances `lastReadOrderAt` and would wipe the boundary). Returns:
   *
   * - `lastReadOrderAt` / `lastReadMessageId` — the persisted `(order_at, id)`
   *   cursor where the divider sits. Message persistence advances it for our
   *   own sends (including sends synced from another device) and for messages
   *   received while the conversation is active. Null means there is no prior
   *   read history to divide from.
   * - `unreadCount` — the unread tally past that cursor (kind 14/15), capped at
   *   {@link UNREAD_CAP}. The **same primitive** (`countUnreadCapped`) maintains
   *   the stored `conversations.unreadCount` that the list badge reads, so the
   *   in-chat number and the outside badge are always one figure. Recomputing
   *   here ensures the divider and stored badge use the same cursor.
   * - `firstUnreadOrderAt` / `firstUnreadMessageId` — the exact first row past
   *   the cursor. This indexed one-row lookup lets the UI preload toward, or
   *   directly anchor on, the divider without counting or loading all history.
   *
   * The read runs right after `setActiveConversation`, so a message landing in
   * the gap is `isActive` and never bumps anything.
   */
  async captureUnreadAndMarkRead(
    accountPubkey: string,
    conversationKey: string,
  ): Promise<{
    unreadCount: number;
    lastReadOrderAt: number | null;
    lastReadMessageId: string | null;
    firstUnreadOrderAt: number | null;
    firstUnreadMessageId: string | null;
  }> {
    const convRows = await db
      .select({
        lastReadOrderAt: conversations.lastReadOrderAt,
        lastReadMessageId: conversations.lastReadMessageId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      )
      .limit(1);
    const watermark =
      convRows[0]?.lastReadOrderAt != null
        ? { orderAt: convRows[0].lastReadOrderAt, id: convRows[0].lastReadMessageId ?? '' }
        : null;

    const [unreadCount, firstUnreadRows] = await Promise.all([
      countUnreadCapped(db, accountPubkey, conversationKey, watermark),
      watermark
        ? db
            .select({ orderAt: messages.orderAt, id: messages.id })
            .from(messages)
            .where(unreadWhere(accountPubkey, conversationKey, watermark))
            .orderBy(asc(messages.orderAt), asc(messages.id))
            .limit(1)
        : Promise.resolve([]),
    ]);

    await this.markConversationAsRead(accountPubkey, conversationKey);
    return {
      unreadCount,
      lastReadOrderAt: watermark?.orderAt ?? null,
      lastReadMessageId: watermark?.id || null,
      firstUnreadOrderAt: firstUnreadRows[0]?.orderAt ?? null,
      firstUnreadMessageId: firstUnreadRows[0]?.id ?? null,
    };
  }

  /** Manually flag a (read) conversation as unread — a self-reminder. Sets a
   * count of 1 so it shows the unread badge and counts toward the tab total;
   * opening the conversation clears it via {@link markConversationAsRead}. */
  async markConversationAsUnread(
    accountPubkey: string,
    conversationKey: string,
  ): Promise<void> {
    await db
      .update(conversations)
      .set({ unreadCount: 1 })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      );
  }

  /**
   * Soft-delete a conversation: hides it from list views while preserving
   * the underlying messages. A new incoming message resurrects the row,
   * but `hasReplied` is reset so it lands in Requests, not the main inbox.
   */
  async deleteConversation(
    accountPubkey: string,
    conversationKey: string,
  ): Promise<void> {
    const deletedOrderAt = Date.now();
    await db
      .update(conversations)
      .set({
        deleted: true,
        deletedAt: Math.floor(deletedOrderAt / 1000),
        deletedOrderAt,
        hasReplied: false,
        unreadCount: 0,
      })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      );

    // Free this conversation's decrypted attachments (reference-counted, so a
    // blob shared with another live conversation is kept). Backgrounded and
    // best-effort — the soft delete itself must not wait on filesystem I/O. If
    // the chat resurrects, attachments re-download on demand.
    setTimeout(() => {
      void deleteConversationAttachments(accountPubkey, conversationKey).catch(() => {});
    }, 0);
  }

  private isConversationActive(accountPubkey: string, conversationKey: string): boolean {
    return isActiveConversationVisible(
      this.activeConversation,
      accountPubkey,
      conversationKey,
      !platform.notifications.shouldNotifyNow(),
    );
  }

  /**
   * Send a message **optimistically**:
   *   1. Build the rumor (deterministic id, no relay calls).
   *   2. Write the rumor + outbox row locally → UI shows the bubble immediately.
   *   3. Resolve recipient encryption keys, wrap, publish — all in the background.
   *      Errors land in `outbox.status = 'failed'`.
   *
   * The returned promise resolves as soon as step 2 finishes (typically <50ms).
   */
  /**
   * Send a kind 7 reaction to a message. Same gift-wrap pipeline as sendMessage,
   * but with kind 7 and an `e` tag pointing at the target rumor id.
   */
  async sendReaction(opts: SendReactionOpts): Promise<{ rumorId: string }> {
    const timestamp = nextRumorTimestamp();
    const customEmoji = typeof opts.emoji === 'string' ? null : opts.emoji;
    const content =
      typeof opts.emoji === 'string' ? opts.emoji : `:${opts.emoji.shortcode}:`;
    const tags = withMessageOrderTag([
      ...opts.recipientPubkeys.map((r): string[] => ['p', r]),
      ['e', opts.targetMessageId],
      ...(customEmoji
        ? [buildEmojiTag({ shortcode: customEmoji.shortcode, url: customEmoji.url })]
        : []),
    ], timestamp.millisecond);
    const rumorTemplate: EventTemplate = {
      kind: KIND_REACTION,
      content,
      tags,
      created_at: timestamp.createdAt,
    };
    const rumor = buildRumor(rumorTemplate, opts.accountPubkey);

    // Seed live delivery before the durable row can reach the message query.
    // Otherwise the optimistic bubble hands off to a DB-backed bubble with no
    // delivery record yet, whose legacy fallback looks like a sent checkmark.
    deliveryStatusStore.getState().begin(rumor.id!);
    await this.storeRumor(rumor, opts.accountPubkey);
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(outbox)
      .values({
        messageId: rumor.id!,
        accountPubkey: opts.accountPubkey,
        status: 'sending',
        attempts: 1,
        updatedAt: now,
      })
      .onConflictDoNothing();

    void this.publishRumorInBackground(rumor, rumorTemplate, {
      accountPubkey: opts.accountPubkey,
      encryptionKeypair: opts.encryptionKeypair,
      recipientPubkeys: opts.recipientPubkeys,
      content,
      replyToId: undefined,
    });

    return { rumorId: rumor.id! };
  }

  async sendMessage(opts: SendMessageOpts): Promise<{ rumorId: string }> {
    // 1. Build rumor (kind 14 chat)
    const timestamp = opts.timestamp ?? nextRumorTimestamp();
    const content = normalizeBareNostrUris(opts.content);
    let tags: string[][] = opts.recipientPubkeys.map((r) => ['p', r]);
    if (opts.extraTags) tags.push(...opts.extraTags);
    if (opts.replyToId) tags.push(['e', opts.replyToId]);    if (opts.subject) tags.push(['subject', opts.subject]);
    tags = withMessageOrderTag(tags, timestamp.millisecond);

    // The UI captures this timestamp at tap time so the optimistic bubble and
    // stored rumor share the same authenticated ordering value.
    const rumorTemplate: EventTemplate = {
      kind: KIND_CHAT,
      content,
      tags,
      created_at: timestamp.createdAt,
    };
    const rumor = buildRumor(rumorTemplate, opts.accountPubkey);

    // Seed live delivery before the durable row can reach the message query.
    // This keeps the optimistic-to-persisted handoff in the signing phase.
    deliveryStatusStore.getState().begin(rumor.id!);
    // 2. Optimistic write — bubble appears now
    await this.storeRumor(rumor, opts.accountPubkey);
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(outbox)
      .values({
        messageId: rumor.id!,
        accountPubkey: opts.accountPubkey,
        status: 'sending',
        attempts: 1,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 3. Background publish (do NOT await — let the UI proceed)
    void this.publishRumorInBackground(rumor, rumorTemplate, { ...opts, content });

    return { rumorId: rumor.id! };
  }

  /**
   * Forward a message to one conversation: re-send the original rumor's `kind` +
   * `content` + content tags (`forwardableTags` — file metadata etc.) under new
   * recipient `p` tags, through the same store + gift-wrap + publish path. Works
   * for text (kind 14) and attachments (kind 15) alike — the file's decryption
   * key/imeta ride in the tags, so the recipient decrypts the same blob; no
   * re-upload. Caller forwards to many chats by calling once per conversation.
   */
  async forwardMessage(opts: {
    accountPubkey: string;
    recipientPubkeys: string[];
    kind: number;
    content: string;
    contentTags: string[][];
    timestamp?: RumorTimestamp;
  }): Promise<{ rumorId: string }> {
    const timestamp = opts.timestamp ?? nextRumorTimestamp();
    const tags = withMessageOrderTag([
      ...opts.recipientPubkeys.map((r) => ['p', r]),
      ...opts.contentTags,
    ], timestamp.millisecond);
    const rumorTemplate: EventTemplate = {
      kind: opts.kind,
      content: opts.content,
      tags,
      created_at: timestamp.createdAt,
    };
    const rumor = buildRumor(rumorTemplate, opts.accountPubkey);

    // Seed live delivery before the durable row can reach the message query.
    deliveryStatusStore.getState().begin(rumor.id!);
    await this.storeRumor(rumor, opts.accountPubkey);
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(outbox)
      .values({
        messageId: rumor.id!,
        accountPubkey: opts.accountPubkey,
        status: 'sending',
        attempts: 1,
        updatedAt: now,
      })
      .onConflictDoNothing();

    void this.publishRumorInBackground(rumor, rumorTemplate, {
      accountPubkey: opts.accountPubkey,
      recipientPubkeys: opts.recipientPubkeys,
      content: opts.content,
    });

    return { rumorId: rumor.id! };
  }

  /**
   * Resend a message to a chosen subset of relays (typically the ones that
   * failed). Re-signs a **fresh seal + gift wrap** for each recipient (new
   * ephemeral key) and publishes only to `relayUrls`, then re-evaluates and
   * persists that message's delivery status.
   */
  async resendToRelays(opts: {
    rumorId: string;
    relayUrls: string[];
  }): Promise<void> {
    if (!this.accountPubkey || !this.encryptionKeypair) {
      throw new Error('DM service not initialized');
    }
    if (opts.relayUrls.length === 0) return;
    const acct = this.accountPubkey;
    const encKp = this.encryptionKeypair;

    // Flip the chosen relays to 'sending' immediately for instant feedback —
    // from the in-memory entry if present (no DB wait); otherwise we seed it
    // from the persisted row below.
    const delivery = deliveryStatusStore.getState();
    const live = delivery.byId[opts.rumorId];
    if (live) delivery.beginResend(opts.rumorId, live.copies, opts.relayUrls);

    const [msgRow] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.accountPubkey, acct), eq(messages.id, opts.rumorId)))
      .limit(1);
    if (!msgRow?.rumor) return;
    const rumor = msgRow.rumor as Rumor;

    if (!live) {
      const [delRow] = await db
        .select()
        .from(messageDeliveries)
        .where(eq(messageDeliveries.messageId, opts.rumorId))
        .limit(1);
      delivery.beginResend(opts.rumorId, delRow?.copies ?? [], opts.relayUrls);
    }

    const rumorTemplate: EventTemplate = {
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      created_at: rumor.created_at,
    };
    const recipients = getPTags(rumor.tags).filter((p) => p !== acct);

    // Lazy identity signer — answers NIP-42 auth AND signs the seals (kind 13).
    let signerPromise: Promise<Signer> | null = null;
    const signWithIdentity: SignSeal = async (template) => {
      if (!signerPromise) signerPromise = buildSigner(acct);
      return (await signerPromise).signEvent(template);
    };

    // Re-wrap (fresh seal + gift wrap) per recipient — same rumor id, new outer.
    // Resend only targets the recipient copies; the self copy isn't re-sent.
    const reWraps: { recipient: string; event: Event }[] = [];
    for (const r of recipients) {
      const encKey = await encryptionKeyWatcher.resolve(r);
      if (!encKey) continue;
      const { giftWrap } = await createGiftWrappedMessage({
        rumorTemplate,
        senderIdentityPubkey: acct,
        senderEncPrivkey: encKp.privkey,
        senderEncPubkey: encKp.pubkey,
        recipientIdentityPubkey: r,
        recipientEncPubkey: encKey,
        signSeal: signWithIdentity,
      });
      reWraps.push({ recipient: r, event: giftWrap });
    }

    if (reWraps.length === 0) {
      for (const r of recipients) {
        for (const url of opts.relayUrls) {
          delivery.markRelay(opts.rumorId, r, false, url, 'failed', 'No recipient key');
        }
      }
    } else {
      await Promise.all(
        reWraps.map(({ recipient, event }) =>
          relayPool.publishEvent({
            relays: opts.relayUrls,
            event,
            signAuth: signWithIdentity,
            timeoutMs: PUBLISH_TIMEOUT_MS,
            onRelay: (url, outcome) =>
              delivery.markRelay(
                opts.rumorId,
                recipient,
                false,
                url,
                outcome.ok ? 'ok' : 'failed',
                outcome.ok ? undefined : outcome.reason,
              ),
          }),
        ),
      );
    }

    // Re-evaluate the verdict over the recipient copies and persist all copies.
    const updated = deliveryStatusStore.getState().byId[opts.rumorId];
    const copyRecords: DeliveryCopyRecord[] = (updated?.copies ?? []).map((cp) => ({
      recipient: cp.recipient,
      self: cp.self,
      relays: cp.relays.map(
        (r): DeliveryRelayRecord => ({
          url: r.url,
          status: r.status === 'ok' ? 'ok' : 'failed',
          error: r.status === 'ok' ? undefined : r.error,
        }),
      ),
    }));
    const recipientRelays = surfacedCopies(copyRecords).flatMap((c) => c.relays);
    const okCount = recipientRelays.filter((r) => r.status === 'ok').length;
    delivery.finish(
      opts.rumorId,
      isDelivered(okCount, recipientRelays.length) ? 'sent' : 'failed',
    );
    await this.persistDelivery(opts.rumorId, msgRow.conversationKey, copyRecords);
  }

  /** Retry an attempt that failed before it had relay copies to target. The
   * original stored rumor keeps its id and timestamp; only its wrapping and
   * delivery attempt are restarted. */
  async retryMessage(opts: { accountPubkey: string; rumorId: string }): Promise<void> {
    const [msgRow] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, opts.accountPubkey),
          eq(messages.id, opts.rumorId),
        ),
      )
      .limit(1);
    if (!msgRow?.rumor) throw new Error('Message not found');

    const rumor = msgRow.rumor as Rumor;
    deliveryStatusStore.getState().begin(rumor.id!);
    await db
      .update(outbox)
      .set({
        status: 'sending',
        attempts: sql`${outbox.attempts} + 1`,
        lastError: null,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(outbox.messageId, rumor.id!));

    const rumorTemplate: EventTemplate = {
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      created_at: rumor.created_at,
    };
    void this.publishRumorInBackground(rumor, rumorTemplate, {
      accountPubkey: opts.accountPubkey,
      recipientPubkeys: getPTags(rumor.tags),
      content: rumor.content,
    });
  }

  private async publishRumorInBackground(
    rumor: Rumor,
    rumorTemplate: EventTemplate,
    opts: SendMessageOpts,
  ): Promise<void> {
    // Callers seed phase 'signing' before persisting the rumor, so the DB-backed
    // bubble can never render between optimistic state and live delivery state.
    const delivery = deliveryStatusStore.getState();

    // Conversation key for the persisted delivery row (same derivation as
    // storeRumor); computed here so it's available in the catch block too.
    const pTags = getPTags(rumor.tags);
    // Outgoing is always 1:1 / note-to-self, so this never returns null; fall
    // back to our own pubkey defensively rather than crash a send.
    const convKey =
      deriveConversationKey(rumor.pubkey, pTags, opts.accountPubkey) ?? opts.accountPubkey;
    // Only real chat / file bubbles get a persisted status (not reactions).
    const persists = rumor.kind === KIND_CHAT || rumor.kind === KIND_FILE;

    try {
      // Persist the authored rumor first, then hold only its publication while
      // startup prepares the account session. This keeps the bubble durable and
      // visible instead of returning its text to the composer.
      const readiness = this.waitUntilSendReady(opts.accountPubkey);
      if (readiness) await readiness;
      const signSeal = this.signSeal!;
      const encryptionKeypair = this.encryptionKeypair!;

      // Resolve each recipient's encryption pubkey AND inbox relays up front —
      // both are hard preconditions for delivery. A recipient that publishes no
      // DM relays cannot be reached (they don't read ours), so this is treated
      // the same as a missing encryption key: fail fast, *before* the CPU-heavy
      // wrap signing below, instead of silently falling back to our own relays.
      // Both lookups are cache-first (encryption key kept warm via `watch()` and
      // preloaded by init(); DM relays cached with a TTL), so an established
      // conversation resolves instantly rather than blocking on a relay round-trip.
      const ownRelays = this.dmRelays;
      // Everyone who needs a copy: each recipient PLUS ourselves (so our other
      // devices pick up the send). Deduped — a note-to-self (recipient == us)
      // collapses to a single participant, so we never wrap the same message to
      // our own inbox twice. Self is just one participant among the rest.
      const participants = Array.from(new Set([...opts.recipientPubkeys, opts.accountPubkey]));
      const encMap: Record<string, string> = {};
      const relaysMap: Record<string, string[]> = {};
      for (const p of participants) {
        if (p === opts.accountPubkey) {
          // Our own encryption key + inbox relays are known locally — no relay
          // lookup needed, and this can never fail the send.
          encMap[p] = encryptionKeypair.pubkey;
          relaysMap[p] = ownRelays;
          continue;
        }
        const encKey = await encryptionKeyWatcher.resolve(p);
        if (!encKey) {
          throw new Error(
            `Recipient ${p.slice(0, 8)}… has no published NIP-17 encryption key`,
          );
        }
        const recipientRelays = await fetchDmRelays({ pubkey: p });
        if (recipientRelays.length === 0) {
          throw new Error(`Recipient ${p.slice(0, 8)}… has no published DM relays`);
        }
        encMap[p] = encKey;
        // Cap delivery fan-out to the peer's first few inbox relays: a peer
        // advertising many DM relays shouldn't explode our publish set. Their
        // private inbox has no public substitute, so we cap — never discard.
        relaysMap[p] = capDeliveryRelays(recipientRelays);
      }

      // Yield to the event loop before the CPU-heavy gift-wrap signing
      // (NIP-44 + schnorr, synchronous). This lets the just-stored bubble paint
      // and the scroll-to-bottom animation run before the thread is hogged, so
      // sending feels responsive even though the crypto itself is blocking.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // One gift wrap per participant — recipients (to their own inbox relays,
      // which alone decide whether the other party receives it) and the self copy
      // (to our relays, for multi-device sync), built uniformly. Each call
      // rebuilds the rumor from the same template, so every wrap carries the
      // identical rumor id we stored above. Tracked per copy (with a `self` flag)
      // so two participants sharing a relay stay distinct and the
      // delivered-to-the-other-party verdict can exclude self.
      const copies: { recipient: string; self: boolean; relays: string[]; event: Event }[] = [];
      for (const p of participants) {
        const { giftWrap } = await createGiftWrappedMessage({
          rumorTemplate,
          senderIdentityPubkey: opts.accountPubkey,
          senderEncPrivkey: encryptionKeypair.privkey,
          senderEncPubkey: encryptionKeypair.pubkey,
          recipientIdentityPubkey: p,
          recipientEncPubkey: encMap[p],
          signSeal,
        });
        copies.push({
          recipient: p,
          self: p === opts.accountPubkey,
          relays: relaysMap[p],
          event: giftWrap,
        });
      }

      // Persist the exact encrypted copies before touching the network. The
      // generic outbox can now resume either relay or proximity delivery after
      // a restart without rebuilding a gift wrap (and without changing its id).
      await db
        .update(outbox)
        .set({
          conversationKey: convKey,
          deliveryKind: 'relay',
          pendingPayload: {
            version: 1,
            deliveryKind: 'relay',
            copies: copies.map((copy) => ({
              recipientPubkey: copy.recipient,
              self: copy.self,
              giftWrap: copy.event,
              relayUrls: copy.relays,
            })),
          },
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(outbox.messageId, rumor.id!));

      // Lazy identity signer for NIP-42 auth — built only if a relay actually
      // answers `auth-required`, so the common (no-auth) path stays cheap.
      let signerPromise: Promise<Signer> | null = null;
      const signAuth = async (authEvt: EventTemplate): Promise<Event> => {
        if (!signerPromise) signerPromise = buildSigner(opts.accountPubkey);
        return (await signerPromise).signEvent(authEvt);
      };

      // Phase 'sending': every copy goes through the shared `publishEvent`,
      // streaming each relay's outcome into the delivery store via a
      // copy-scoped `onRelay` so the bubble's n/m updates live.
      delivery.startSending(
        rumor.id!,
        copies.map((c) => ({ recipient: c.recipient, self: c.self, urls: c.relays })),
      );
      const makeOnRelay =
        (recipient: string, self: boolean) =>
        (url: string, outcome: { ok: boolean; reason?: string }) =>
          delivery.markRelay(
            rumor.id!,
            recipient,
            self,
            url,
            outcome.ok ? 'ok' : 'failed',
            outcome.ok ? undefined : outcome.reason,
          );

      const settled = await Promise.all(
        copies.map((c) =>
          relayPool
            .publishEvent({
              relays: c.relays,
              event: c.event,
              signAuth,
              timeoutMs: PUBLISH_TIMEOUT_MS,
              onRelay: makeOnRelay(c.recipient, c.self),
            })
            .then((results) => ({ copy: c, results })),
        ),
      );

      const copyRecords: DeliveryCopyRecord[] = settled.map(({ copy, results }) => ({
        recipient: copy.recipient,
        self: copy.self,
        relays: results.map(
          (r): DeliveryRelayRecord => ({
            url: r.url,
            status: r.outcome.ok ? 'ok' : 'failed',
            error: r.outcome.ok ? undefined : r.outcome.reason,
          }),
        ),
      }));

      // Verdict over the surfaced copies — the recipient (non-self) copies, i.e.
      // did the other party get it; or, for a note-to-self with no other party,
      // the self copy itself (see surfacedCopies).
      const recipientRelayRecords = surfacedCopies(copyRecords).flatMap((c) => c.relays);
      const okCount = recipientRelayRecords.filter((r) => r.status === 'ok').length;
      const delivered = isDelivered(okCount, recipientRelayRecords.length);

      delivery.finish(rumor.id!, delivered ? 'sent' : 'failed');
      if (persists) await this.persistDelivery(rumor.id!, convKey, copyRecords);

      // Outbox retry bookkeeping: a stored copy anywhere (incl. self) counts.
      const anySucceeded = copyRecords.some((c) => c.relays.some((r) => r.status === 'ok'));

      const now = Math.floor(Date.now() / 1000);
      if (anySucceeded) {
        await db
          .update(outbox)
          .set({ status: 'sent', updatedAt: now })
          .where(eq(outbox.messageId, rumor.id!));
        setTimeout(() => {
          void db
            .delete(outbox)
            .where(eq(outbox.messageId, rumor.id!))
            .run()
            .catch((error) => {
              console.warn('[dm] Failed to remove a delivered outbox entry.', error);
            });
        }, OUTBOX_SENT_CLEANUP_MS);
      } else {
        await db
          .update(outbox)
          .set({
            status: 'failed',
            lastError: 'All relays rejected',
            updatedAt: now,
          })
          .where(eq(outbox.messageId, rumor.id!));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      delivery.finish(rumor.id!, 'failed', reason);
      if (persists) await this.persistDelivery(rumor.id!, convKey, []);
      await db
        .update(outbox)
        .set({
          status: 'failed',
          lastError: reason,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(outbox.messageId, rumor.id!));
    }
  }

  /** Upsert the persisted (restart-surviving) delivery summary for a message. */
  private async persistDelivery(
    messageId: string,
    conversationKey: string,
    copies: DeliveryCopyRecord[],
  ): Promise<void> {
    // Verdict over the surfaced copies — the recipient (non-self) copies; or, for
    // a note-to-self, the self copy (see surfacedCopies). For a normal message the
    // self copy is stored but never counted toward the status.
    const recipientRelays = surfacedCopies(copies).flatMap((c) => c.relays);
    const okCount = recipientRelays.filter((r) => r.status === 'ok').length;
    const status = isDelivered(okCount, recipientRelays.length) ? 'sent' : 'failed';
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(messageDeliveries)
      .values({ messageId, conversationKey, copies, status, updatedAt: now })
      .onConflictDoUpdate({
        target: messageDeliveries.messageId,
        set: { copies, status, updatedAt: now },
      });
  }

  /** Queue an incoming gift wrap for batched, yielding processing. */
  private enqueueGiftWrap(giftWrap: Event): void {
    this.giftWrapQueue.push(giftWrap);
    if (!this.drainingGiftWraps) void this.drainGiftWrapQueue();
  }

  /** Process the queue in small batches, yielding to the event loop between
   * batches so taps and rendering aren't starved during a large replay burst. */
  private async drainGiftWrapQueue(): Promise<void> {
    if (this.drainingGiftWraps) return;
    this.drainingGiftWraps = true;
    try {
      while (this.giftWrapQueue.length > 0) {
        const e = this.giftWrapQueue.shift()!;
        try {
          await this.processGiftWrap(e);
        } catch (error) {
          // A transient database or adapter failure must not reject the detached
          // drain promise or prevent later envelopes from being processed.
          console.warn('[dm] Failed to process an incoming envelope.', error);
        }
        // One gift wrap can already include sync SQLite + crypto; yield after
        // every message so a replay burst cannot monopolize the JS thread.
        await yieldToUi();
      }
    } finally {
      this.drainingGiftWraps = false;
    }
  }

  /**
   * Unwrap + store one gift wrap, **skipping decryption for ids we've already
   * processed** (dedup). NIP-44 + schnorr decryption is the expensive part, and
   * relays replay the same wraps on every connect; the id check is a cheap PK
   * lookup that avoids redoing it. Verified seals without an n tag are marked
   * processed without decrypting their content. Envelopes that fail with every
   * available key are also marked processed to avoid repeated replay work.
   */
  private processGiftWrap(giftWrap: Event): Promise<Rumor | null> {
    const task = this.processGiftWrapForCurrentSession(giftWrap);
    this.inFlightGiftWrapTasks.add(task);
    const forget = () => this.inFlightGiftWrapTasks.delete(task);
    task.then(forget, forget);
    return task;
  }

  private async processGiftWrapForCurrentSession(giftWrap: Event): Promise<Rumor | null> {
    const profile = createPerfSpan('dm.processGiftWrap', { kind: giftWrap.kind });
    let outcome = 'unknown';
    try {
      const accountPubkey = this.accountPubkey;
      const encryptionKeys = this.encryptionKeys;
      const epoch = this.syncEpoch;
      if (encryptionKeys.length === 0 || !accountPubkey) {
        outcome = 'not-ready';
        return null;
      }
      const isCurrent = () => this.syncEpoch === epoch && this.accountPubkey === accountPubkey;
      const alreadyProcessed = await profileAsync(profile, 'db.isProcessed', () =>
        isGiftWrapProcessed(giftWrap.id),
      );
      if (!isCurrent()) {
        outcome = 'stale';
        return null;
      }
      if (alreadyProcessed) {
        outcome = 'duplicate';
        return null;
      }
      // Try keys newest-first: the current key (the common case, one attempt),
      // then older keys so a peer still encrypting to a rotated-away key can be read.
      const unwrap = await profileAsync(profile, 'crypto.unwrapGiftWrap', () =>
        unwrapGiftWrapWithKeys(giftWrap, encryptionKeys, profile),
      );
      if (!isCurrent()) {
        outcome = 'stale';
        return null;
      }
      if (unwrap.status !== 'decrypted') {
        await profileAsync(profile, 'db.markProcessed', () =>
          markGiftWrapProcessed(giftWrap.id, accountPubkey),
        );
        outcome = unwrap.status === 'failed' ? 'decrypt-failed' : unwrap.reason;
        return null;
      }
      const result = unwrap.value;
      let stored: Rumor | null = null;
      // Drop messages from blocked senders before they ever reach the store —
      // never saved, never surfaced. Our own self-copies carry our pubkey (never
      // blocked), so outgoing sync is unaffected. Marked processed so we don't
      // re-attempt decryption on every relay replay.
      const blocked = profileSync(profile, 'block.isBlocked', () =>
        isBlocked(accountPubkey, result.rumor.pubkey),
      );
      if (blocked) {
        await profileAsync(profile, 'db.markProcessed', () =>
          markGiftWrapProcessed(giftWrap.id, accountPubkey),
        );
        outcome = 'blocked';
        return null;
      }
      // Capture which relays delivered this gift wrap, so the message-info drawer
      // can show "received from". Bridge the wrap id (what `receivedEvent` keys
      // by) to the rumor id (what the UI looks up) so relays that arrive *after*
      // this first store still union into the live "received from" set.
      const entry = this.giftWrapSeenOn.get(giftWrap.id);
      if (entry) {
        entry.rumorId = result.rumor.id;
        this.rumorToGiftWrap.set(result.rumor.id!, giftWrap.id);
      }
      const sourceRelays = entry ? Array.from(entry.relays) : [];
      const inserted = await this.storeRumor(
        result.rumor,
        accountPubkey,
        sourceRelays,
        profile,
      );
      if (inserted && isCurrent()) {
        for (const l of this.listeners) l.onNewMessage?.(result.rumor);
        stored = result.rumor;
      }
      if (!isCurrent()) return null;
      await profileAsync(profile, 'db.markProcessed', () =>
        markGiftWrapProcessed(giftWrap.id, accountPubkey),
      );
      outcome = stored ? 'stored' : 'duplicate-or-unsupported';
      // The freshly-stored rumor (or null when re-seen/blocked/undecryptable) lets
      // the background poll count how many *new* messages to notify about.
      return stored;
    } finally {
      profile?.end({ result: outcome });
    }
  }

  /**
   * Background notification recovery over a fixed recent overlap window.
   * Refresh routing and keys first, then page each relay independently through
   * the isolated receiver. This never starts history backfill or advances its
   * cursors. Already-processed IDs skip decryption; freshly stored rumors go to
   * the notification service's shared filtering and aggregation funnel.
   */
  async pollForNotifications(
    accountPubkey: string,
    options: { abort?: AbortSignal } = {},
  ): Promise<Rumor[]> {
    const session = receiveSessionStore.getState();
    if (session.status === 'key-required' && session.accountPubkey === accountPubkey) {
      throw new MessagingKeySyncRequiredError(session.encryptionPubkey);
    }
    // A periodic task must never bypass a foreground preparation or resurrect
    // its receiver with stale local keys. Use an isolated, cancellable receiver
    // so a cold poll cannot overwrite a live/init session across async reads.
    if (this.initializing || options.abort?.aborted) return [];
    if (this.accountPubkey && this.accountPubkey !== accountPubkey) return [];
    if (
      this.accountPubkey === accountPubkey && this.historyBackfillComplete &&
      !this.liveCoverageBroken && relayPool.hasHealthySubscription('dm.live') &&
      selfEventStream.isHealthy()
    ) return [];
    const epoch = this.syncEpoch;
    const receiver = new DmService();
    const controller = new AbortController();
    this.notificationPolls.add(controller);
    controller.signal.addEventListener('abort', () => {
      receiver.syncEpoch++;
      receiver.accountPubkey = null;
      receiver.encryptionKeys = [];
    }, { once: true });
    const cancel = () => controller.abort();
    const sessionSignal = this.receiveAbort?.signal;
    options.abort?.addEventListener('abort', cancel, { once: true });
    sessionSignal?.addEventListener('abort', cancel, { once: true });
    const isCurrent = () => !controller.signal.aborted && this.syncEpoch === epoch;
    let stopKeyWatch: (() => void) | undefined;
    let changedKey: string | null = null;
    try {
      const signer = await buildSigner(accountPubkey);
      const signAuth = (event: EventTemplate) => signer.signEvent(event);
      const metadata = await resolveMessagingMetadata(accountPubkey, {
        signAuth, abort: controller.signal,
      });
      const keys = await loadEncryptionKeys(accountPubkey);
      if (!isCurrent()) return [];
      if (this.accountPubkey === accountPubkey && metadata.announcement) {
        const changed = this.handleEncryptionKeyAnnouncement(metadata.announcement);
        if (changed) throw new MessagingKeySyncRequiredError(changed);
      }
      const remote = metadata.announcement && getEncryptionPubkeyFromEvent(metadata.announcement);
      if (remote && !keys.some((key) => key.pubkey === remote)) {
        this.pauseForKeySync(accountPubkey, remote);
        throw new MessagingKeySyncRequiredError(remote);
      }
      if (keys.length === 0) return [];
      await loadBlockedIntoCache(accountPubkey);
      if (!isCurrent()) return [];
      receiver.accountPubkey = accountPubkey;
      receiver.encryptionKeys = keys;
      receiver.activeConversation = this.activeConversation;
      if (this.accountPubkey !== accountPubkey) {
        // Cold workers have no self-event stream. Keep key invalidation active
        // throughout paging, including a rotation after the metadata snapshot.
        let latest = metadata.announcement;
        const initialKey = remote ?? keys[0].pubkey;
        stopKeyWatch = relayPool.subscribe({
          label: 'dm.notification-key-watch',
          relays: metadata.announcementRelays.length > 0
            ? metadata.announcementRelays : metadata.dmRelays,
          filter: { kinds: [KIND_ENCRYPTION_KEY_ANNOUNCEMENT], authors: [accountPubkey], limit: 1 },
          signAuth,
          abort: controller.signal,
          onEvent: (event) => {
            if (!isCurrent() || event.pubkey !== accountPubkey || !isNewerAnnouncement(event, latest)) return;
            const pubkey = getEncryptionPubkeyFromEvent(event);
            if (!pubkey) return;
            latest = event;
            if (pubkey === initialKey) return;
            changedKey = pubkey;
            this.pauseForKeySync(accountPubkey, pubkey);
          },
        });
      }
      const stored: Rumor[] = [];
      const until = Math.floor(Date.now() / 1000);
      const interrupted = await pollRecentGiftWraps({
        accountPubkey,
        relays: metadata.dmRelays,
        since: Math.max(0, until - FORWARD_OVERLAP_SECONDS),
        until,
        abort: controller.signal,
        isCurrent,
        signAuth,
        onReceived: (relayUrl, id) => receiver.recordGiftWrapSeen(id, relayUrl),
        onEvent: async (event) => {
          if (!isCurrent()) return;
          const task = receiver.processGiftWrap(event);
          this.inFlightGiftWrapTasks.add(task);
          let rumor: Rumor | null;
          try { rumor = await task; } finally { this.inFlightGiftWrapTasks.delete(task); }
          if (!isCurrent()) return;
          if (rumor) stored.push(rumor);
          await yieldToUi();
        },
      });
      if (changedKey) throw new MessagingKeySyncRequiredError(changedKey);
      if (isCurrent() && interrupted.length > 0) {
        console.warn('[DM] Notification window incomplete; retry on the next poll', interrupted);
      }
      return stored;
    } finally {
      stopKeyWatch?.();
      cancel();
      this.notificationPolls.delete(controller);
      options.abort?.removeEventListener('abort', cancel);
      sessionSignal?.removeEventListener('abort', cancel);
    }
  }

  /** Record (idempotently) that `relayUrl` delivered the gift wrap `giftWrapId`.
   * Fires for every relay's delivery — including ones arriving after the first,
   * which `onEvent` dedups away — so the source-relay set becomes a true union. */
  private recordGiftWrapSeen(giftWrapId: string, relayUrl: string): void {
    const existing = this.giftWrapSeenOn.get(giftWrapId);
    if (existing) {
      if (existing.relays.has(relayUrl)) return; // already counted
      existing.relays.add(relayUrl);
      // A relay arriving *after* the first store grew the set. The store wrote a
      // one-time snapshot, so without re-persisting here the new relay would live
      // only in memory and vanish on restart (leaving the DB stuck at the first
      // relay). Persist the grown union so source_relays only ever grows. Only
      // once stored (rumorId known); pre-store growth is folded into the snapshot.
      // The wrap was delivered to (and stored under) the active account — scope
      // the write-back to it so it touches only that account's copy.
      if (existing.rumorId && this.accountPubkey) {
        void this.persistSourceRelays(
          this.accountPubkey,
          existing.rumorId,
          Array.from(existing.relays),
        );
      }
      return;
    }
    this.giftWrapSeenOn.set(giftWrapId, { relays: new Set([relayUrl]), at: Date.now() });
    if (this.giftWrapSeenOn.size > GIFT_WRAP_SEEN_LIMIT) this.pruneGiftWrapSeen();
  }

  /** Overwrite a stored message's `source_relays` with the grown union. Safe as a
   * plain overwrite (not a union with the DB): write-back only fires for a wrap
   * stored *this* session, whose in-memory set is monotonically growing — a
   * re-delivered, already-processed wrap short-circuits before it gets a
   * `rumorId`, so a prior session's persisted set is never overwritten. */
  private async persistSourceRelays(
    accountPubkey: string,
    rumorId: string,
    relays: string[],
  ): Promise<void> {
    try {
      await db
        .update(messages)
        .set({ sourceRelays: relays })
        .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, rumorId)));
    } catch {
      // Best-effort: a failed write just retries on the next relay delivery.
    }
  }

  /** Drop source-relay records older than the max age. Triggered only when the
   * map crosses its cap, so it's driven by activity (no wall-clock timer that a
   * backgrounded JS thread couldn't run) and never wipes a still-fresh entry. */
  private pruneGiftWrapSeen(): void {
    const cutoff = Date.now() - GIFT_WRAP_SEEN_MAX_AGE_MS;
    for (const [id, e] of this.giftWrapSeenOn) {
      if (e.at < cutoff) {
        this.giftWrapSeenOn.delete(id);
        if (e.rumorId) this.rumorToGiftWrap.delete(e.rumorId);
      }
    }
  }

  /** Relays an incoming message (by rumor id) has been delivered from this
   * session — the live union the message-info drawer adds on top of the row's
   * persisted `source_relays`, so relays that reported after first sight show.
   * Empty once the entry ages out (the persisted snapshot remains the floor). */
  getReceivedFromRelays(rumorId: string): string[] {
    const giftWrapId = this.rumorToGiftWrap.get(rumorId);
    if (!giftWrapId) return [];
    const entry = this.giftWrapSeenOn.get(giftWrapId);
    return entry ? Array.from(entry.relays) : [];
  }

  /** Foreground owns starting/retrying history; leaving the foreground does
   * not abort an admitted pass. Account/key changes still cancel the receiver. */
  private startHistoryBackfill(): void {
    if (
      platform.appState.currentState() !== 'active' || this.historyBackfillTask ||
      !this.accountPubkey || !this.dmLiveSubUnsub
    ) return;
    const epoch = this.syncEpoch;
    const through = Math.floor(Date.now() / 1000);
    const task = this.backfillHistory(this.accountPubkey, epoch, through)
      .catch((error: unknown) => {
        console.warn(
          '[dm] History backfill failed; progress will resume on the next foreground entry.',
          error,
          'cause:',
          error instanceof Error ? error.cause : undefined,
        );
      })
      .finally(() => {
        if (this.historyBackfillTask === task) this.historyBackfillTask = null;
      });
    this.historyBackfillTask = task;
  }

  /**
   * Bring the account's gift-wrap history up to date asynchronously, across
   * the two paged frontiers (see `sync-store`): the forward gap first (newest —
   * what the user is waiting for), then deep history.
   *
   *  - Forward gap: drain `(forwardSince, through]` page by page, then
   *    advance `forwardSince` to its cutoff. Not persisted mid-drain — a kill
   *    re-drains the gap on the next foreground entry, skipping processed ids.
   *    First pass (`forwardSince` null) → floor = through → an
   *    empty drain that simply records the pass cutoff. No special case.
   *  - Deep history: page `backwardUntil` down to the beginning of time,
   *    persisting after every page so a kill resumes on the next foreground
   *    entry; `BACKFILL_DONE` (0) means complete and is skipped thereafter.
   *
   * Both yield between pages while the UI is active (see {@link drainWindow}),
   * so even a huge history never blocks UI rendering.
   */
  private async backfillHistory(accountPubkey: string, epoch: number, through: number): Promise<void> {
    const cursor = await getSyncCursor(accountPubkey);
    if (this.syncEpoch !== epoch) return;

    // Surface "Updating…" in the Chats title while either frontier is draining.
    // Epoch-guard the reset so a stale loop (after an account switch) can't clear
    // the flag the new session just set.
    syncStatusStore.getState().setBackfilling(true);
    try {
      // Forward gap: everything that arrived (or was `limit`-truncated off the
      // live tail) since we were last fully synced up to `forwardSince`.
      const forwardFloor = cursor.forwardSince ?? through;
      const forward = await this.drainWindow(
        accountPubkey,
        through,
        forwardFloor,
        epoch,
      );
      // Claim the recent side complete up to this foreground pass only once fully drained.
      if (this.syncEpoch !== epoch) return;
      if (forward === 'drained') await setForwardSince(accountPubkey, through);

      let backwardComplete = cursor.backwardUntil === BACKFILL_DONE;
      // Deep history: page toward the beginning of time, resuming from the cursor.
      if (cursor.backwardUntil !== BACKFILL_DONE) {
        const backwardFrom = cursor.backwardUntil ?? through;
        const backward = await this.drainWindow(
          accountPubkey,
          backwardFrom,
          BACKFILL_DONE,
          epoch,
          (u) => setBackwardUntil(accountPubkey, u),
        );
        if (this.syncEpoch !== epoch) return;
        if (backward === 'drained') {
          await setBackwardUntil(accountPubkey, BACKFILL_DONE);
          backwardComplete = true;
        }
      }
      if (this.syncEpoch === epoch) {
        this.historyBackfillComplete = forward === 'drained' && backwardComplete;
      }
    } finally {
      if (this.syncEpoch === epoch) syncStatusStore.getState().setBackfilling(false);
    }
  }

  /**
   * Page gift wraps newest-first from `until` down to `floor`, decrypting and
   * storing each. The shared primitive behind both backfill frontiers.
   *
   * Single-cursor paging is mandatory: a relay caps each filter at its default
   * `limit`, so a `since`+`until` range query can silently drop the older events
   * in a busy window. We only ever pass `until` (+ `limit`) and walk it down a
   * page at a time; `floor` is purely the loop's stop line — it never goes into
   * the filter.
   *
   * Multi-relay pitfall handled: each relay holds a different subset, so we don't
   * advance by the merged set's oldest — a sparse relay would yank the cursor far
   * back and skip events others hold in between. Instead we **merge, sort, keep
   * only PAGE events**, and advance to that slice's oldest; everything beyond is
   * re-fetched next round (cheap via dedup).
   *
   * Yields between pages so even a huge history never blocks UI rendering.
   * `onPageAdvance` (awaited) persists progress after each page for resumable
   * frontiers. Returns:
   *  - 'drained'     — reached the floor, or any relay EOSE'd on an empty round;
   *  - 'interrupted' — no relay completed the query. Do not seal the frontier (mark backfill
   *                    done / advance `forwardSince`); the cursor stays put and
   *                    next launch retries — otherwise one network blip would end
   *                    history forever;
   *  - 'aborted'     — the epoch went stale (account switch / destroy) mid-run.
   */
  private async drainWindow(
    accountPubkey: string,
    until: number,
    floor: number,
    epoch: number,
    onPageAdvance?: (until: number) => void | Promise<void>,
  ): Promise<'drained' | 'interrupted' | 'aborted'> {
    while (this.syncEpoch === epoch && until > floor) {
      let eosed = false;
      const events = await relayPool.query({
        label: 'dm.backfill',
        abort: this.receiveAbort?.signal,
        relays: this.dmRelays,
        filter: { kinds: [KIND_GIFT_WRAP], '#p': [accountPubkey], until, limit: BACKFILL_PAGE },
        timeoutMs: BACKFILL_QUERY_TIMEOUT_MS,
        signAuth: this.signAuth ?? undefined,
        onReceived: (relayUrl, id) => this.recordGiftWrapSeen(id, relayUrl),
        onComplete: (info) => {
          eosed = info.eosed;
        },
      }).catch((error: unknown) => {
        if (this.syncEpoch !== epoch || error instanceof RelayQueryError) return [];
        throw error;
      });
      if (this.syncEpoch !== epoch) return 'aborted'; // account switched / destroyed

      // Dedup this round across relays, newest-first.
      const unique = Array.from(new Map(events.map((e) => [e.id, e])).values()).sort(
        (a, b) => b.created_at - a.created_at,
      );

      // All relays settle before the round completes. Failed queries must leave
      // the frontier unsealed so a later attempt can resume.
      if (unique.length === 0) return eosed ? 'drained' : 'interrupted';

      // Keep only the newest PAGE and advance to *its* oldest (see above).
      const page = unique.slice(0, BACKFILL_PAGE);
      for (const e of page) {
        if (this.syncEpoch !== epoch) return 'aborted';
        await this.processGiftWrap(e);
        // Yield after every message; a single unwrap/store is the largest unit
        // of synchronous work left on this path.
        await yieldToUi();
      }

      if (this.syncEpoch !== epoch) return 'aborted';
      const oldest = page[page.length - 1].created_at;
      // Re-include the boundary timestamp next round (dedup skips re-seen ids);
      // force progress if a whole page shares one timestamp.
      until = oldest < until ? oldest : until - 1;
      await onPageAdvance?.(until);
    }
    return 'drained';
  }

  private async handleClientKeyAnnouncement(event: Event): Promise<void> {
    if (!this.accountPubkey) return;
    const clientPubkey = getClientPubkeyFromEvent(event);
    if (!clientPubkey) return;
    if (this.fulfilledSyncRequestClients.has(clientPubkey)) {
      await persistSyncRequestProcessed(this.accountPubkey, event.id);
      return;
    }
    // Skip anything already handled: a peer request we sent/dismissed, or one we
    // issued ourselves — the requesting device persists its own 4454 id, the only
    // way to recognise it after the transfer succeeds and we re-init (the
    // ephemeral client key it announced with is gone by then).
    if (await isSyncRequestProcessed(this.accountPubkey, event.id)) return;
    // A 4455 may arrive while the durable processed-id lookup is in flight.
    // Recheck before surfacing the approval so relay ordering cannot briefly
    // show a request that another device already fulfilled.
    if (this.fulfilledSyncRequestClients.has(clientPubkey)) {
      await persistSyncRequestProcessed(this.accountPubkey, event.id);
      return;
    }
    for (const l of this.syncRequestListeners) l(event);
  }

  private handleKeyTransfer(event: Event): void {
    for (const pubkey of getPTags(event.tags)) {
      this.fulfilledSyncRequestClients.add(pubkey);
    }
    for (const l of this.keyTransferListeners) l(event);
  }

  private handleEncryptionKeyAnnouncement(event: Event): string | null {
    if (!this.encryptionKeypair || !isNewerAnnouncement(event, this.latestKeyAnnouncement)) return null;
    const previousPubkey = this.latestKeyAnnouncement && getEncryptionPubkeyFromEvent(this.latestKeyAnnouncement);
    this.latestKeyAnnouncement = event;
    const newPubkey = getEncryptionPubkeyFromEvent(event);
    if (!newPubkey || newPubkey === previousPubkey || newPubkey === this.encryptionKeypair.pubkey) return null;
    this.pauseForKeySync(this.accountPubkey!, newPubkey);
    return newPubkey;
  }

  /** Close message subscriptions and cancel queued/in-flight reads synchronously,
   * before any UI listener or storage await can delay the key-transfer gate. */
  private pauseForKeySync(accountPubkey: string, newPubkey: string): void {
    this.destroy();
    relayPool.destroy();
    receiveSessionStore.setState({
      status: 'key-required', accountPubkey, encryptionPubkey: newPubkey,
    }, true);
    for (const listener of this.encryptionKeyChangedListeners) listener(newPubkey);
  }

  /**
   * Another device edited our own relay lists (10002/10050, observed by the
   * self-event stream): debounce ~1.5s, then rebuild every REQ by re-running
   * init with the fresh DM relay list. Init destroys itself first, which also
   * tears down and restarts the self-event stream — the stream therefore needs
   * no restart logic of its own. Epoch-guarded so a stale timer from a previous
   * account/session can never resurrect it.
   */
  private scheduleRelayListReinit(): void {
    if (this.relayListReinitTimer) clearTimeout(this.relayListReinitTimer);
    const epoch = this.syncEpoch;
    // Background RN timers may be suspended. Relay-list changes directly affect
    // where new messages arrive, so rebuild immediately while no UI is rendering.
    if (platform.appState.currentState() !== 'active') {
      this.relayListReinitTimer = null;
      void this.reinitWithFreshRelayLists(epoch);
      return;
    }
    this.relayListReinitTimer = setTimeout(() => {
      this.relayListReinitTimer = null;
      if (epoch !== this.syncEpoch || !this.accountPubkey) return;
      void this.reinitWithFreshRelayLists(epoch);
    }, 1500);
  }

  /** Apply locally saved routing only to an already ready messaging session. */
  refreshRelayConfiguration(accountPubkey: string): void {
    const session = receiveSessionStore.getState();
    if (session.status === 'ready' && session.accountPubkey === accountPubkey && this.accountPubkey === accountPubkey) {
      this.scheduleRelayListReinit();
    }
  }

  private async reinitWithFreshRelayLists(epoch: number): Promise<void> {
    const accountPubkey = this.accountPubkey;
    if (!accountPubkey) return;
    const dmRelays = await loadAccountDmRelays(accountPubkey);
    if (epoch !== this.syncEpoch || this.accountPubkey !== accountPubkey) return;
    await this.init({ accountPubkey, dmRelays });
  }

  /** Import one bounded batch of decrypted rumors, reusing the live save path.
   * The caller streams large archives in batches; last-message selection is
   * order-aware, so the file need not be held and globally sorted in memory. */
  async importRumors(
    accountPubkey: string,
    rumors: Rumor[],
  ): Promise<{ inserted: number; existing: number; invalid: number }> {
    const valid = rumors
      .filter((r) => r && typeof r.id === 'string' && typeof r.kind === 'number')
      .sort((a, b) => a.created_at - b.created_at);
    let inserted = 0;
    let existing = 0;
    let unsupported = 0;
    for (const rumor of valid) {
      const result = await this.storeRumor(rumor, accountPubkey);
      if (result === true) inserted += 1;
      else if (result === false) existing += 1;
      else unsupported += 1;
    }
    return {
      inserted,
      existing,
      invalid: rumors.length - valid.length + unsupported,
    };
  }

  /** Insert rumor + participants + update per-account conversation row. */
  private async storeRumor(
    rumor: Rumor,
    accountPubkey: string,
    sourceRelays?: string[],
    profile?: PerfSpan | null,
  ): Promise<boolean | null> {
    const pTags = getPTags(rumor.tags);
    const conversationKey = profileSync(profile, 'store.deriveConversation', () =>
      deriveConversationKey(rumor.pubkey, pTags, accountPubkey),
    );
    // Group / CC (more than one counterparty) and rumors not addressed to us are
    // unsupported — drop the whole rumor, storing no row.
    if (conversationKey === null) return null;
    const subject = getSubject(rumor.tags) ?? null;
    const replyToId = getReplyToId(rumor.tags) ?? null;
    const orderAt = messageOrderAt(rumor);

    const stored = await profileAsync(profile, 'db.storeTransaction', () =>
      db.transaction(async (tx) => {
        const inserted = await profileAsync(profile, 'db.insertMessage', () =>
          tx
            .insert(messages)
            .values({
              accountPubkey,
              id: rumor.id!,
              conversationKey,
              senderPubkey: rumor.pubkey,
              kind: rumor.kind,
              content: rumor.content,
              createdAt: rumor.created_at,
              orderAt,
              replyToId,
              subject,
              tags: rumor.tags,
              rumor,
              sourceRelays: sourceRelays && sourceRelays.length > 0 ? sourceRelays : null,
            })
            .onConflictDoNothing()
            .returning({ id: messages.id })
            .all(),
        );
        if (inserted.length === 0) return false;

        // Index every media URL at the persistence choke point. Kind-15 has one
        // encrypted attachment; kind-14 may contain several direct media URLs.
        if (rumor.kind === 15) {
          await profileAsync(profile, 'db.recordAttachmentMedia', () =>
            recordAttachmentMedia(tx, rumor, accountPubkey, conversationKey),
          );
        } else if (rumor.kind === 14) {
          await profileAsync(profile, 'db.recordEmbeddedMedia', () =>
            recordEmbeddedMedia(tx, rumor, accountPubkey, conversationKey),
          );
        }

      const isOutgoing = rumor.pubkey === accountPubkey;
      const isReaction = rumor.kind === 7;
      const isActive = this.isConversationActive(accountPubkey, conversationKey);
      // Advance the read cursor to this message when we've evidently seen up to
      // it: our own send (incl. one synced from another device — we replied
      // there), or any message arriving while we're viewing the conversation.
      // Reactions don't move it (the cursor tracks real kind-14/15 messages).
      const advanceRead = (isOutgoing || isActive) && !isReaction;
      // A message that adds to the unread badge: from the peer, not a reaction,
      // and not while we're viewing the conversation. Independent of arrival
      // order — see the out-of-order branch below.
      const bumpUnread = !isOutgoing && !isReaction && !isActive;

        const existing = await profileAsync(profile, 'db.selectConversation', () =>
          tx
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.accountPubkey, accountPubkey),
                eq(conversations.conversationKey, conversationKey),
              ),
            )
            .limit(1)
            .all(),
        );

      // The inbox-vs-request gate is per-conversation (`hasReplied`): a stranger's
      // first message lands in Requests until we reply, and deleting a chat resets
      // that so a later message becomes a fresh request again. Explicit contacts
      // are the only bypass — someone the user deliberately saved is trusted and
      // routes straight to the main inbox, even after a delete. (Contacts are
      // never auto-added; only an explicit "add" puts someone here.) Checked only
      // for incoming 1:1 messages, and only when we'd otherwise leave it unreplied.
      const needsContactCheck = !isOutgoing && existing[0]?.hasReplied !== true;
        const senderIsContact =
          needsContactCheck &&
          (await profileAsync(profile, 'db.selectContact', () =>
            tx
              .select({ pubkey: contacts.pubkey })
              .from(contacts)
              .where(
                and(
                  eq(contacts.accountPubkey, accountPubkey),
                  eq(contacts.pubkey, rumor.pubkey),
                ),
              )
              .limit(1)
              .all(),
          )).length > 0;
      const repliedNow = isOutgoing || senderIsContact;

      if (existing.length === 0) {
        await profileAsync(profile, 'db.insertConversation', () =>
          tx
            .insert(conversations)
            .values({
              accountPubkey,
              conversationKey,
              name: subject,
              lastMessageAt: rumor.created_at,
              lastMessageOrderAt: orderAt,
              lastMessageId: rumor.id!,
              unreadCount: bumpUnread ? 1 : 0,
              // Seed the read cursor at this message when we've seen up to it (own
              // send / active view) — so it never counts as unread against us.
              lastReadAt: advanceRead ? rumor.created_at : null,
              lastReadOrderAt: advanceRead ? orderAt : null,
              lastReadMessageId: advanceRead ? rumor.id! : null,
              hasReplied: repliedNow,
            })
            .run(),
        );
      } else {
        const conv = existing[0];
        // A deleted conversation must not be resurrected by an old / re-delivered
        // event: only messages created after the deletion timestamp count. Older
        // ones leave the row deleted (the message itself is still stored above).
        const blockedByDeletion =
          conv.deleted && conv.deletedOrderAt != null && orderAt <= conv.deletedOrderAt;
        if (!blockedByDeletion) {
          // Only the newest message moves the "last message" pointer and
          // resurrects a soft-deleted row; an out-of-order older one still counts
          // toward unread (tying that to "is newest" was the under-count bug).
          const isNewest =
            orderAt > conv.lastMessageOrderAt ||
            (orderAt === conv.lastMessageOrderAt && rumor.id! > (conv.lastMessageId ?? ''));
          // Advance the read cursor **forward only**. A self/active message that
          // arrives out of order — older than the cursor, which is the norm during
          // history backfill (it pages newest→oldest) — must not drag the cursor
          // backwards and re-mark newer messages (including our own later replies)
          // unread. `maxCursor` keeps it monotonic.
          const prevCursor: ReadCursor | null =
            conv.lastReadOrderAt != null
              ? { orderAt: conv.lastReadOrderAt, id: conv.lastReadMessageId ?? '' }
              : null;
          const nextCursor = advanceRead
            ? maxCursor({ orderAt, id: rumor.id! }, prevCursor)
            : prevCursor;
          const newCursorOrderAt = nextCursor?.orderAt ?? null;
          const newCursorId = nextCursor?.id || null;
          // Recompute the unread tally against the (possibly advanced) cursor —
          // single source of truth for both the list badge and the in-chat count.
          // Skip only when already maxed and this message can't lower it (doesn't
          // advance the cursor): it stays 99+, no scan needed.
          const unread =
            !advanceRead && conv.unreadCount >= UNREAD_CAP
              ? conv.unreadCount
              : await countUnreadCapped(
                  tx,
                  accountPubkey,
                  conversationKey,
                  newCursorOrderAt != null
                    ? { orderAt: newCursorOrderAt, id: newCursorId ?? '' }
                    : null,
                  profile,
                );
          await profileAsync(profile, 'db.updateConversation', () =>
            tx
              .update(conversations)
              .set({
                lastMessageAt: isNewest && !isReaction ? rumor.created_at : conv.lastMessageAt,
                lastMessageOrderAt:
                  isNewest && !isReaction ? orderAt : conv.lastMessageOrderAt,
                lastMessageId: isNewest && !isReaction ? rumor.id! : conv.lastMessageId,
                unreadCount: unread,
                lastReadAt: nextCursor?.orderAt === orderAt ? rumor.created_at : conv.lastReadAt,
                lastReadOrderAt: newCursorOrderAt,
                lastReadMessageId: newCursorId,
                hasReplied: repliedNow ? true : conv.hasReplied,
                name: subject && !conv.name ? subject : conv.name,
                deleted: isNewest ? false : conv.deleted,
              })
              .where(
                and(
                  eq(conversations.accountPubkey, accountPubkey),
                  eq(conversations.conversationKey, conversationKey),
                ),
              )
              .run(),
          );
        }
      }
      return true;
      }),
    );
    if (stored) {
      // The write already holds every column — merge into the warm tail instead
      // of invalidating it and queueing a full window re-read.
      mergeStoredMessageIntoTail(accountPubkey, {
        accountPubkey,
        id: rumor.id!,
        conversationKey,
        senderPubkey: rumor.pubkey,
        kind: rumor.kind,
        content: rumor.content,
        createdAt: rumor.created_at,
        orderAt,
        replyToId,
        subject,
        tags: rumor.tags,
        rumor,
        sourceRelays: sourceRelays && sourceRelays.length > 0 ? sourceRelays : null,
      });
    }
    return stored;
  }
}

export const dmService = new DmService();
