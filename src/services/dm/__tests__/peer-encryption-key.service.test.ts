import { encryptionKeyWatcher } from '../encryption-key-watcher';
import { observedPeerKeyService } from '../observed-peer-key.service';
import {
  resolvePeerMessagingMetadata,
  resolvePeersMessagingMetadata,
} from '../peer-encryption-key.service';
import { fetchDmRelays, getKnownDmRelays } from '../../relay/relay-list.service';

jest.mock('../encryption-key-watcher', () => ({
  encryptionKeyWatcher: {
    resolveAnnouncement: jest.fn(),
    forceRefreshAnnouncement: jest.fn(),
    refreshAnnouncementIfStale: jest.fn(),
  },
}));
jest.mock('../observed-peer-key.service', () => ({
  observedPeerKeyService: {
    resolve: jest.fn(),
    rememberKeyAnnouncement: jest.fn(),
    markAnnouncementChecked: jest.fn(),
    onKeyChanged: jest.fn(),
  },
}));
jest.mock('../../relay/relay-list.service', () => ({
  fetchDmRelays: jest.fn(async () => []),
  getKnownDmRelays: jest.fn(async () => null),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchDmRelays).mockResolvedValue([]);
  jest.mocked(getKnownDmRelays).mockResolvedValue(null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sealEvidence(peerPubkey: string, encryptionPubkey: string) {
  return {
    peerPubkey,
    encryptionPubkey,
    source: 'seal' as const,
    evidenceId: 'seal-id',
    evidenceCreatedAt: 2_000,
    announcementCheckedAt: null,
    observedAt: 2,
  };
}

it('returns complete local metadata immediately and queues its background refresh', async () => {
  const pendingAnnouncement = deferred<null>();
  const pendingRelays = deferred<string[]>();
  jest.mocked(observedPeerKeyService.resolve).mockResolvedValue(
    sealEvidence('local-peer', 'local-key'),
  );
  jest.mocked(getKnownDmRelays).mockResolvedValue(['wss://local.example']);
  jest.mocked(encryptionKeyWatcher.refreshAnnouncementIfStale).mockReturnValue(
    pendingAnnouncement.promise,
  );
  jest.mocked(fetchDmRelays).mockReturnValue(pendingRelays.promise);
  const onRelayQuery = jest.fn();

  await expect(resolvePeerMessagingMetadata({
    peerPubkey: 'local-peer',
    searchRelays: [],
    onRelayQuery,
  })).resolves.toEqual({
    encryptionPubkey: 'local-key',
    dmRelays: ['wss://local.example'],
  });
  expect(encryptionKeyWatcher.resolveAnnouncement).not.toHaveBeenCalled();
  expect(onRelayQuery).not.toHaveBeenCalled();

  pendingAnnouncement.resolve(null);
  pendingRelays.resolve(['wss://local.example']);
  await resolvePeersMessagingMetadata(['local-peer'], []);
  expect(observedPeerKeyService.markAnnouncementChecked).toHaveBeenCalledWith(
    'local-peer',
    expect.any(Number),
  );
});

it('waits for missing key and relay metadata before resolving', async () => {
  jest.mocked(observedPeerKeyService.resolve)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      peerPubkey: 'missing-peer',
      encryptionPubkey: 'prepared-key',
      source: 'kind-10044',
      evidenceId: 'announcement-id',
      evidenceCreatedAt: 3_000,
      announcementCheckedAt: 3,
      observedAt: 3,
    });
  jest.mocked(encryptionKeyWatcher.resolveAnnouncement).mockResolvedValue({
    encryptionPubkey: 'prepared-key',
    eventId: 'announcement-id',
    createdAt: 3,
    fetchedAt: 4,
  });
  jest.mocked(fetchDmRelays).mockResolvedValue(['wss://prepared.example']);

  await expect(resolvePeerMessagingMetadata({
    peerPubkey: 'missing-peer',
    searchRelays: ['wss://search.example'],
  })).resolves.toEqual({
    encryptionPubkey: 'prepared-key',
    dmRelays: ['wss://prepared.example'],
  });
  expect(fetchDmRelays).toHaveBeenCalledWith({
    pubkey: 'missing-peer',
    searchRelays: ['wss://search.example'],
    force: true,
    onRelayQuery: expect.any(Function),
  });
});

it.each(['key', 'relays'] as const)('reports a missing %s lookup only when it leaves local state', async missing => {
  const local = deferred<ReturnType<typeof sealEvidence> | null>();
  const queried = deferred<void>();
  const remote = deferred<null>();
  const onRelayQuery = jest.fn();
  jest.mocked(observedPeerKeyService.resolve).mockReturnValue(local.promise);
  jest.mocked(getKnownDmRelays).mockResolvedValue(missing === 'key' ? ['wss://peer.example'] : null);
  jest.mocked(encryptionKeyWatcher.resolveAnnouncement).mockImplementation((_peer, onQuery) => {
    onQuery?.();
    queried.resolve();
    return remote.promise;
  });
  jest.mocked(fetchDmRelays).mockImplementation(async opts => {
    opts.onRelayQuery?.();
    queried.resolve();
    await remote.promise;
    return ['wss://peer.example'];
  });

  const result = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [], onRelayQuery });
  expect(onRelayQuery).not.toHaveBeenCalled();
  local.resolve(missing === 'key' ? null : sealEvidence('peer', 'key'));
  await queried.promise;
  expect(onRelayQuery).toHaveBeenCalledTimes(1);
  remote.resolve(null);
  await result;
});

it('notifies concurrent callers joining before and after a shared relay query starts', async () => {
  const local = deferred<null>();
  const queried = deferred<void>();
  const remote = deferred<string[]>();
  jest.mocked(observedPeerKeyService.resolve).mockReturnValue(local.promise);
  jest.mocked(encryptionKeyWatcher.resolveAnnouncement).mockImplementation(async (_peer, onQuery) => {
    onQuery?.();
    return null;
  });
  jest.mocked(fetchDmRelays).mockImplementation(opts => {
    opts.onRelayQuery?.();
    queried.resolve();
    return remote.promise;
  });
  const early = jest.fn();
  const late = jest.fn();
  // Prefetch can own the request before the chat subscribes to its progress.
  const first = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [] });
  const second = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [], onRelayQuery: early });
  expect(early).not.toHaveBeenCalled();
  local.resolve(null);
  await queried.promise;
  expect(early).toHaveBeenCalledTimes(1);
  const third = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [], onRelayQuery: late });
  expect(late).toHaveBeenCalledTimes(1);
  remote.resolve(['wss://peer.example']);
  await Promise.all([first, second, third]);
  expect(early).toHaveBeenCalledTimes(1);
  expect(late).toHaveBeenCalledTimes(1);
  expect(fetchDmRelays).toHaveBeenCalledTimes(1);
});

it('force-refreshes both key and relay metadata through the same resolver', async () => {
  jest.mocked(observedPeerKeyService.resolve).mockResolvedValue(
    sealEvidence('peer', 'current-key'),
  );
  jest.mocked(encryptionKeyWatcher.forceRefreshAnnouncement).mockResolvedValue(null);
  jest.mocked(fetchDmRelays).mockResolvedValue(['wss://fresh.example']);

  await expect(resolvePeerMessagingMetadata({
    peerPubkey: 'peer',
    searchRelays: ['wss://search.example'],
    force: true,
  })).resolves.toEqual({
    encryptionPubkey: 'current-key',
    dmRelays: ['wss://fresh.example'],
  });
  expect(encryptionKeyWatcher.forceRefreshAnnouncement).toHaveBeenCalled();
  expect(fetchDmRelays).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
});

it('merges the daily background announcement refresh into the materialized row', async () => {
  jest.mocked(observedPeerKeyService.resolve).mockResolvedValue(
    sealEvidence('peer', 'local-key'),
  );
  jest.mocked(getKnownDmRelays).mockResolvedValue(['wss://local.example']);
  jest.mocked(encryptionKeyWatcher.refreshAnnouncementIfStale).mockResolvedValue({
    encryptionPubkey: 'announced-key',
    eventId: 'announcement-id',
    createdAt: 5,
    fetchedAt: 6,
  });

  await resolvePeersMessagingMetadata(['peer'], ['wss://search.example']);

  expect(observedPeerKeyService.rememberKeyAnnouncement).toHaveBeenCalledWith({
    peerPubkey: 'peer',
    encryptionPubkey: 'announced-key',
    evidenceId: 'announcement-id',
    evidenceCreatedAt: 5_000,
    announcementCheckedAt: 6,
  });
});

it('singleflights concurrent metadata requests for the same peer', async () => {
  const pendingKey = deferred<null>();
  jest.mocked(observedPeerKeyService.resolve).mockResolvedValue(null);
  jest.mocked(getKnownDmRelays).mockResolvedValue(null);
  jest.mocked(encryptionKeyWatcher.resolveAnnouncement).mockReturnValue(pendingKey.promise);
  jest.mocked(fetchDmRelays).mockResolvedValue(['wss://peer.example']);

  const first = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [] });
  const second = resolvePeerMessagingMetadata({ peerPubkey: 'peer', searchRelays: [] });
  expect(observedPeerKeyService.resolve).toHaveBeenCalledTimes(1);

  pendingKey.resolve(null);
  await Promise.all([first, second]);
  expect(encryptionKeyWatcher.resolveAnnouncement).toHaveBeenCalledTimes(1);
  expect(fetchDmRelays).toHaveBeenCalledTimes(1);
});
