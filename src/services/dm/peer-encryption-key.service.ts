import { encryptionKeyWatcher } from './encryption-key-watcher';
import { observedPeerKeyService } from './observed-peer-key.service';
import { fetchDmRelays, getKnownDmRelays } from '../relay/relay-list.service';

const ANNOUNCEMENT_REFRESH_TTL_SECONDS = 24 * 60 * 60;
const REFRESH_CONCURRENCY = 4;

type MetadataRefresh = {
  peerPubkey: string;
  searchRelays: Set<string>;
  promise: Promise<void>;
  resolve: () => void;
};

type MetadataFlight = {
  searchRelays: Set<string>;
  promise: Promise<PeerMessagingDeliveryMetadata>;
};

const metadataRefreshes = new Map<string, MetadataRefresh>();
const metadataQueue: MetadataRefresh[] = [];
const metadataFlights = new Map<string, MetadataFlight>();
let activeMetadataRefreshes = 0;

export type PeerEncryptionKeyResolution = {
  encryptionPubkey: string | null;
  source: 'observed-message' | 'public-announcement' | null;
};

export type PeerMessagingDeliveryMetadata = {
  encryptionPubkey: string | null;
  dmRelays: string[];
};

async function mergeAnnouncement(
  peerPubkey: string,
  announcement: NonNullable<ReturnType<typeof encryptionKeyWatcher.peekAnnouncement>>,
): Promise<void> {
  await observedPeerKeyService.rememberKeyAnnouncement({
    peerPubkey,
    encryptionPubkey: announcement.encryptionPubkey,
    evidenceId: announcement.eventId,
    evidenceCreatedAt: announcement.createdAt * 1000,
    announcementCheckedAt: announcement.fetchedAt,
  });
}

function toResolution(
  evidence: Awaited<ReturnType<typeof observedPeerKeyService.resolve>>,
): PeerEncryptionKeyResolution {
  if (!evidence) return { encryptionPubkey: null, source: null };
  return {
    encryptionPubkey: evidence.encryptionPubkey,
    source: evidence.source === 'seal' ? 'observed-message' : 'public-announcement',
  };
}

async function resolvePeerEncryptionKey(peerPubkey: string): Promise<PeerEncryptionKeyResolution> {
  return toResolution(await observedPeerKeyService.resolve(peerPubkey));
}

/** Populate a missing row, or explicitly refresh it, from kind-10044. */
async function preparePeerEncryptionKey(opts: {
  peerPubkey: string;
  forcePublicRefresh?: boolean;
  onRelayQuery?: () => void;
}): Promise<PeerEncryptionKeyResolution> {
  let evidence = await observedPeerKeyService.resolve(opts.peerPubkey);
  if (evidence && !opts.forcePublicRefresh) return toResolution(evidence);
  const announcement = opts.forcePublicRefresh
    ? await encryptionKeyWatcher.forceRefreshAnnouncement(opts.peerPubkey, opts.onRelayQuery)
    : await encryptionKeyWatcher.resolveAnnouncement(opts.peerPubkey, opts.onRelayQuery);
  if (announcement) {
    await mergeAnnouncement(opts.peerPubkey, announcement);
    evidence = await observedPeerKeyService.resolve(opts.peerPubkey);
  }
  return toResolution(evidence);
}

/** Singleflight peer metadata resolver shared by chat entry and every send path. */
export function resolvePeerMessagingMetadata(opts: {
  peerPubkey: string;
  searchRelays: readonly string[];
  force?: boolean;
  onRelayQuery?: () => void;
}): Promise<PeerMessagingDeliveryMetadata> {
  const flightKey = `${opts.peerPubkey}\u0000${opts.force ? 'force' : 'normal'}`;
  const existing = metadataFlights.get(flightKey);
  if (existing) {
    for (const relay of opts.searchRelays) existing.searchRelays.add(relay);
    return existing.promise;
  }
  const searchRelays = new Set(opts.searchRelays);
  const promise = resolvePeerMessagingMetadataInternal({
    peerPubkey: opts.peerPubkey,
    searchRelays,
    force: opts.force === true,
    onRelayQuery: opts.onRelayQuery,
  }).finally(() => {
    if (metadataFlights.get(flightKey)?.promise === promise) metadataFlights.delete(flightKey);
  });
  metadataFlights.set(flightKey, { searchRelays, promise });
  return promise;
}

async function resolvePeerMessagingMetadataInternal(opts: {
  peerPubkey: string;
  searchRelays: Set<string>;
  force: boolean;
  onRelayQuery?: () => void;
}): Promise<PeerMessagingDeliveryMetadata> {
  if (opts.force) {
    const [key, dmRelays] = await Promise.all([
      preparePeerEncryptionKey({
        peerPubkey: opts.peerPubkey,
        forcePublicRefresh: true,
        onRelayQuery: opts.onRelayQuery,
      }),
      fetchDmRelays({
        pubkey: opts.peerPubkey,
        searchRelays: Array.from(opts.searchRelays),
        force: true,
        onRelayQuery: opts.onRelayQuery,
      }),
    ]);
    return { encryptionPubkey: key.encryptionPubkey, dmRelays };
  }

  const [knownKey, knownRelays] = await Promise.all([
    resolvePeerEncryptionKey(opts.peerPubkey),
    getKnownDmRelays(opts.peerPubkey),
  ]);
  if (knownKey.encryptionPubkey && knownRelays && knownRelays.length > 0) {
    void queuePeerMetadataRefresh(opts.peerPubkey, Array.from(opts.searchRelays));
    return { encryptionPubkey: knownKey.encryptionPubkey, dmRelays: knownRelays };
  }

  const [preparedKey, preparedRelays] = await Promise.all([
    knownKey.encryptionPubkey
      ? Promise.resolve(knownKey)
      : preparePeerEncryptionKey({ peerPubkey: opts.peerPubkey }),
    knownRelays && knownRelays.length > 0
      ? Promise.resolve(knownRelays)
      : fetchDmRelays({
          pubkey: opts.peerPubkey,
          searchRelays: Array.from(opts.searchRelays),
          force: true,
        }),
  ]);
  return {
    encryptionPubkey: preparedKey.encryptionPubkey,
    dmRelays: preparedRelays,
  };
}

/** Bounded batch wrapper used by conversation entry; each peer still uses the same flight. */
export async function resolvePeersMessagingMetadata(
  peerPubkeys: readonly string[],
  searchRelays: readonly string[],
): Promise<void> {
  const peers = Array.from(new Set(peerPubkeys));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < peers.length) {
      const peerPubkey = peers[next++];
      await resolvePeerMessagingMetadata({ peerPubkey, searchRelays }).catch(() => undefined);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, peers.length) }, () => worker()),
  );
}

function queuePeerMetadataRefresh(
  peerPubkey: string,
  searchRelays: readonly string[],
): Promise<void> {
  const existing = metadataRefreshes.get(peerPubkey);
  if (existing) {
    for (const relay of searchRelays) existing.searchRelays.add(relay);
    return existing.promise;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const refresh: MetadataRefresh = {
    peerPubkey,
    searchRelays: new Set(searchRelays),
    promise,
    resolve,
  };
  metadataRefreshes.set(peerPubkey, refresh);
  metadataQueue.push(refresh);
  drainMetadataQueue();
  return promise;
}

function drainMetadataQueue(): void {
  while (activeMetadataRefreshes < REFRESH_CONCURRENCY && metadataQueue.length > 0) {
    const refresh = metadataQueue.shift()!;
    activeMetadataRefreshes++;
    void runPeerMetadataRefresh(refresh)
      .catch(() => {})
      .finally(() => {
        activeMetadataRefreshes--;
        metadataRefreshes.delete(refresh.peerPubkey);
        refresh.resolve();
        drainMetadataQueue();
      });
  }
}

async function runPeerMetadataRefresh(refresh: MetadataRefresh): Promise<void> {
  const evidence = await observedPeerKeyService.resolve(refresh.peerPubkey).catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  if (
    evidence?.announcementCheckedAt != null &&
    now - evidence.announcementCheckedAt < ANNOUNCEMENT_REFRESH_TTL_SECONDS
  ) {
    await fetchDmRelays({
      pubkey: refresh.peerPubkey,
      searchRelays: Array.from(refresh.searchRelays),
    }).catch(() => []);
    return;
  }
  const [announcement] = await Promise.all([
    encryptionKeyWatcher.refreshAnnouncementIfStale(
      refresh.peerPubkey,
      ANNOUNCEMENT_REFRESH_TTL_SECONDS,
    ),
    fetchDmRelays({
      pubkey: refresh.peerPubkey,
      searchRelays: Array.from(refresh.searchRelays),
    }).catch(() => []),
  ]);
  if (announcement) await mergeAnnouncement(refresh.peerPubkey, announcement);
  else await observedPeerKeyService.markAnnouncementChecked(refresh.peerPubkey, now);
}

/** Device-wide key change stream from verified seals and refreshed announcements. */
export function onPeerEncryptionKeyChanged(listener: (peerPubkey: string) => void): () => void {
  return observedPeerKeyService.onKeyChanged(listener);
}
