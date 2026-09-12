import type { Event } from 'nostr-tools';
import type { AppStateStatus } from '@/platform';

import { dmService } from '../dm.service';
import { receiveSessionStore, MessagingKeySyncRequiredError } from '../receive-session';
import { resolveMessagingMetadata, type MessagingMetadata } from '../messaging-metadata';
import { loadEncryptionKeys } from '../encryption-key.service';
import { relayPool, type SubscribeOpts } from '../../relay/relay-pool';
import { selfEventStream } from '../../self-events/self-event-stream.service';
import { getSyncCursor, markGiftWrapProcessed, setForwardSince, setBackwardUntil } from '../sync-store';
import { unwrapGiftWrapWithKeys, type GiftWrapUnwrapOutcome } from '../../crypto/nip17-gift-wrap';

const mockProcessedIds = new Set<string>();
let mockAppState: AppStateStatus = 'background';
const mockAppStateListeners = new Set<(state: AppStateStatus) => void>();
const mockUserReturnedListeners = new Set<() => void>();
function changeAppState(state: AppStateStatus) {
  mockAppState = state;
  for (const listener of [...mockAppStateListeners]) listener(state);
}
function returnToApp() {
  for (const listener of [...mockUserReturnedListeners]) listener();
}

jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/platform', () => ({ platform: {
  appState: {
    currentState: () => mockAppState,
    addChangeListener: (listener: (state: AppStateStatus) => void) => {
      mockAppStateListeners.add(listener);
      return () => mockAppStateListeners.delete(listener);
    },
  },
  notifications: {
    addUserReturnedListener: (listener: () => void) => {
      mockUserReturnedListeners.add(listener);
      return () => mockUserReturnedListeners.delete(listener);
    },
  },
} }));
jest.mock('../../account/account.service', () => ({ buildSigner: async () => ({ signEvent: jest.fn() }) }));
jest.mock('../../files/media-index.service', () => ({}));
jest.mock('../../files/file-attachment.service', () => ({}));
jest.mock('../../conversation/message-tail-cache', () => ({}));
jest.mock('../../relay/relay-list.service', () => ({ ownKeyTransferRelays: async () => [] }));
jest.mock('../../relay/relay-router', () => ({}));
jest.mock('../../relay/relay-pool', () => ({ relayPool: { subscribe: jest.fn(), query: jest.fn(), destroy: jest.fn(), hasHealthySubscription: jest.fn(() => false) } }));
jest.mock('../../self-events/self-event-stream.service', () => ({
  selfEventStream: { configure: jest.fn(), start: jest.fn(), destroy: jest.fn(), isHealthy: jest.fn(() => true) },
}));
jest.mock('../encryption-key-watcher', () => ({ encryptionKeyWatcher: { init: jest.fn(), destroy: jest.fn() } }));
jest.mock('../block.service', () => ({ loadBlockedIntoCache: jest.fn(), isBlocked: () => false }));
jest.mock('../sync-store', () => ({
  getSyncCursor: jest.fn(), isGiftWrapProcessed: async (id: string) => mockProcessedIds.has(id),
  markGiftWrapProcessed: jest.fn(async (id: string) => { mockProcessedIds.add(id); }),
  setForwardSince: jest.fn(), setBackwardUntil: jest.fn(),
}));
jest.mock('../encryption-key.service', () => ({
  loadEncryptionKeys: jest.fn(),
  getEncryptionPubkeyFromEvent: (event: Event) => event.tags.find((tag) => tag[0] === 'n')?.[1],
}));
jest.mock('../messaging-metadata', () => ({
  ...jest.requireActual('../messaging-metadata'), resolveMessagingMetadata: jest.fn(),
}));
jest.mock('../../crypto/nip17-gift-wrap', () => ({
  KIND_GIFT_WRAP: 1059, KIND_CHAT: 14, KIND_FILE: 15, KIND_REACTION: 7,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT: 10044,
  unwrapGiftWrapWithKeys: jest.fn(),
}));

const self = 'a'.repeat(64);
const oldKey = 'b'.repeat(64);
const newKey = 'c'.repeat(64);
const unsubscribe = jest.fn();
const resolveMetadata = jest.mocked(resolveMessagingMetadata);
function announcement(pubkey: string, time = 10): Event {
  return { kind: 10044, pubkey: self, id: String(time), created_at: time, tags: [['n', pubkey]], content: '', sig: '' };
}
function metadata(pubkey = oldKey): MessagingMetadata {
  return { accountPubkey: self, dmRelays: ['wss://fresh.example'], announcementRelays: [], announcement: announcement(pubkey) };
}
const options = { accountPubkey: self, dmRelays: ['wss://stale.example'] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function live(): SubscribeOpts { return jest.mocked(relayPool.subscribe).mock.calls.at(-1)![0]; }
function rotate(event = announcement(newKey, 20)) {
  jest.mocked(selfEventStream.configure).mock.calls.at(-1)![0].handlers.onKeyAnnouncement(event);
}

beforeEach(() => {
  dmService.destroy();
  mockAppState = 'background';
  receiveSessionStore.setState({ status: 'stopped', accountPubkey: null }, true);
  jest.clearAllMocks();
  mockProcessedIds.clear();
  mockUserReturnedListeners.clear();
  jest.mocked(relayPool.hasHealthySubscription).mockReturnValue(false);
  jest.mocked(selfEventStream.isHealthy).mockReturnValue(true);
  resolveMetadata.mockResolvedValue(metadata());
  jest.mocked(loadEncryptionKeys).mockResolvedValue([{ pubkey: oldKey, privkey: new Uint8Array(32), createdAt: 1 }]);
  jest.mocked(relayPool.subscribe).mockReturnValue(unsubscribe);
  jest.mocked(relayPool.query).mockImplementation(async (opts) => {
    opts.onComplete?.({ eosed: true, status: 'complete', relays: opts.relays.map((url) => ({
      url, status: 'eose', received: 0,
    })) });
    return [];
  });
  jest.mocked(getSyncCursor).mockResolvedValue({ forwardSince: null, backwardUntil: 0 });
  jest.mocked(unwrapGiftWrapWithKeys).mockResolvedValue({ status: 'failed' });
});
afterEach(() => dmService.destroy());

it('opens no message intake before metadata resolves, then uses fresh relays', async () => {
  const pending = deferred<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(pending.promise);
  const starting = dmService.init(options);
  await flush();
  expect(relayPool.subscribe).not.toHaveBeenCalled();
  expect(getSyncCursor).not.toHaveBeenCalled();
  pending.resolve(metadata());
  await starting;
  expect(live().relays).toEqual(['wss://fresh.example']);
});

it('waits for the missing key and only opens intake after a new init with that key', async () => {
  resolveMetadata.mockResolvedValue(metadata(newKey));
  await expect(dmService.init(options)).rejects.toThrow('must be synchronized');
  expect(relayPool.subscribe).not.toHaveBeenCalled();
  expect(getSyncCursor).not.toHaveBeenCalled();
  jest.mocked(loadEncryptionKeys).mockResolvedValue([{ pubkey: newKey, privkey: new Uint8Array(32), createdAt: 2 }]);
  await dmService.init(options);
  expect(live().relays).toEqual(['wss://fresh.example']);
});

it('keeps intake closed when metadata lookup fails', async () => {
  resolveMetadata.mockRejectedValue(new Error('incomplete'));
  await expect(dmService.init(options)).rejects.toThrow('incomplete');
  expect(relayPool.subscribe).not.toHaveBeenCalled();
});

it('invalidates an initialization that is still awaiting metadata', async () => {
  const pending = deferred<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(pending.promise);
  const starting = dmService.init(options);
  dmService.destroy();
  pending.resolve(metadata());
  await expect(starting).rejects.toThrow('cancelled');
  expect(relayPool.subscribe).not.toHaveBeenCalled();
});

it('stops immediately on an unknown key, even if its timestamp predates this launch', async () => {
  await dmService.init(options);
  rotate();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(dmService.getAccountPubkey()).toBeNull();
  live().onEvent({ id: 'late', kind: 1059 } as Event, 'wss://fresh.example');
  await flush();
  expect(unwrapGiftWrapWithKeys).not.toHaveBeenCalled();
});

it('does not pause on an older announcement replay', async () => {
  await dmService.init(options);
  rotate(announcement(newKey, 5));
  expect(unsubscribe).not.toHaveBeenCalled();
});

it('does not mark an in-flight failed decryption processed after rotation', async () => {
  await dmService.init(options);
  const decrypting = deferred<GiftWrapUnwrapOutcome>();
  jest.mocked(unwrapGiftWrapWithKeys).mockReturnValueOnce(decrypting.promise);
  live().onEvent({ id: 'in-flight', kind: 1059 } as Event, 'wss://fresh.example');
  await flush();
  expect(unwrapGiftWrapWithKeys).toHaveBeenCalledTimes(1);
  rotate();
  decrypting.resolve({ status: 'failed' });
  await flush();
  expect(markGiftWrapProcessed).not.toHaveBeenCalled();
});

it('cancels pending backfill without advancing its cursor', async () => {
  mockAppState = 'active';
  jest.mocked(getSyncCursor).mockResolvedValue({ forwardSince: 1, backwardUntil: 0 });
  const queried = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(queried.promise);
  await dmService.init(options);
  await flush();
  const queryOptions = jest.mocked(relayPool.query).mock.calls[0][0];
  rotate();
  expect(queryOptions.abort?.aborted).toBe(true);
  queried.resolve([]);
  await flush();
  expect(setForwardSince).not.toHaveBeenCalled();
});

it('does not let a cold notification poll pull messages with a missing key', async () => {
  resolveMetadata.mockResolvedValue(metadata(newKey));
  await expect(dmService.pollForNotifications(self)).rejects.toBeInstanceOf(MessagingKeySyncRequiredError);
  expect(receiveSessionStore.getState()).toEqual({
    status: 'key-required', accountPubkey: self, encryptionPubkey: newKey,
  });
  expect(relayPool.query).not.toHaveBeenCalled();
  expect(dmService.getAccountPubkey()).toBeNull();
});

it('a background poll leaves the live account and subscriptions intact', async () => {
  await dmService.init(options);
  jest.mocked(selfEventStream.destroy).mockClear();
  await dmService.pollForNotifications(self);
  expect(dmService.getAccountPubkey()).toBe(self);
  expect(selfEventStream.destroy).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
});

it('pages recent notification messages without reading or advancing history cursors', async () => {
  const now = Math.floor(Date.now() / 1000);
  const events = Array.from({ length: 450 }, (_, i) => ({
    id: `poll-${i}`, kind: 1059, created_at: now - i,
  } as Event));
  jest.mocked(relayPool.query).mockImplementation(async (opts) => {
    const page = events.filter((event) => event.created_at <= opts.filter!.until!)
      .slice(0, opts.filter!.limit!);
    opts.onComplete?.({ eosed: true, status: 'complete', relays: [
      { url: opts.relays[0], status: 'eose', received: page.length },
    ] });
    return page;
  });
  await dmService.pollForNotifications(self);
  expect(markGiftWrapProcessed).toHaveBeenCalledTimes(450);
  expect(unwrapGiftWrapWithKeys).toHaveBeenCalledTimes(450);
  expect(getSyncCursor).not.toHaveBeenCalled();
  expect(setForwardSince).not.toHaveBeenCalled();
  expect(setBackwardUntil).not.toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('watches key rotation during a cold poll and discards the outstanding message page', async () => {
  const pending = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(pending.promise);
  const polling = dmService.pollForNotifications(self);
  await flush();
  expect(live().label).toBe('dm.notification-key-watch');
  expect(live().filter).toEqual({ kinds: [10044], authors: [self], limit: 1 });
  live().onEvent(announcement(newKey, 20), 'wss://fresh.example');
  expect(jest.mocked(relayPool.query).mock.calls[0][0].abort?.aborted).toBe(true);
  pending.resolve([{ id: 'stale', kind: 1059 } as Event]);
  await expect(polling).rejects.toBeInstanceOf(MessagingKeySyncRequiredError);
  expect(markGiftWrapProcessed).not.toHaveBeenCalled();
  expect(receiveSessionStore.getState().status).toBe('key-required');
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('ignores an old or same-key announcement during a cold poll', async () => {
  const pending = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(pending.promise);
  const polling = dmService.pollForNotifications(self);
  await flush();
  live().onEvent(announcement(newKey, 9), 'wss://fresh.example');
  live().onEvent(announcement(oldKey, 20), 'wss://fresh.example');
  expect(jest.mocked(relayPool.query).mock.calls[0][0].abort?.aborted).toBe(false);
  pending.resolve([]);
  await polling;
  expect(receiveSessionStore.getState().status).toBe('stopped');
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});


it('marks failed decryption processed and skips replay even after receiving a new key', async () => {
  const event = { id: 'undecryptable-wrap', kind: 1059 } as Event;
  await dmService.init(options);
  live().onEvent(event, 'wss://fresh.example');
  await flush();
  expect(unwrapGiftWrapWithKeys).toHaveBeenCalledTimes(1);
  expect(markGiftWrapProcessed).toHaveBeenCalledWith(event.id, self);

  rotate();
  resolveMetadata.mockResolvedValue(metadata(newKey));
  jest.mocked(loadEncryptionKeys).mockResolvedValue([
    { pubkey: newKey, privkey: new Uint8Array(32), createdAt: 2 },
    { pubkey: oldKey, privkey: new Uint8Array(32), createdAt: 1 },
  ]);
  await dmService.init(options);
  live().onEvent(event, 'wss://fresh.example');
  await flush();
  expect(unwrapGiftWrapWithKeys).toHaveBeenCalledTimes(1);
  expect(markGiftWrapProcessed).toHaveBeenCalledTimes(1);
});

it('reports key sync when an announcement races the opening of self-event subscriptions', async () => {
  jest.mocked(selfEventStream.start).mockImplementationOnce(async () => { rotate(); });
  await expect(dmService.init(options)).rejects.toThrow('must be synchronized');
  expect(relayPool.subscribe).not.toHaveBeenCalled();
  expect(getSyncCursor).not.toHaveBeenCalled();
});

it('cancels a cold poll query when a new session takes over', async () => {
  const pending = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(pending.promise);
  const polling = dmService.pollForNotifications(self);
  await flush();
  const queryOptions = jest.mocked(relayPool.query).mock.calls[0][0];
  dmService.destroy();
  expect(queryOptions.abort?.aborted).toBe(true);
  pending.resolve([{ id: 'late-poll', kind: 1059 } as Event]);
  expect(await polling).toEqual([]);
  expect(unwrapGiftWrapWithKeys).not.toHaveBeenCalled();
});


it('marks an authenticated seal without an n tag processed without storing a message', async () => {
  await dmService.init(options);
  jest.mocked(unwrapGiftWrapWithKeys).mockResolvedValueOnce({
    status: 'unsupported', reason: 'missing-encryption-key-tag',
  });
  live().onEvent({ id: 'ordinary-nip17', kind: 1059 } as Event, 'wss://fresh.example');
  await flush();
  expect(markGiftWrapProcessed).toHaveBeenCalledWith('ordinary-nip17', self);
});

it('does not persist an unsupported result from a receiver invalidated by rotation', async () => {
  await dmService.init(options);
  const decrypting = deferred<GiftWrapUnwrapOutcome>();
  jest.mocked(unwrapGiftWrapWithKeys).mockReturnValueOnce(decrypting.promise);
  live().onEvent({ id: 'stale-ordinary', kind: 1059 } as Event, 'wss://fresh.example');
  await flush();
  rotate();
  decrypting.resolve({ status: 'unsupported', reason: 'missing-encryption-key-tag' });
  await flush();
  expect(markGiftWrapProcessed).not.toHaveBeenCalled();
});


it('skips the recovery poll only after backfill with a healthy uninterrupted live subscription', async () => {
  mockAppState = 'active';
  await dmService.init(options);
  await flush();
  jest.mocked(relayPool.hasHealthySubscription).mockReturnValue(true);
  resolveMetadata.mockClear();
  jest.mocked(relayPool.query).mockClear();
  await dmService.pollForNotifications(self);
  expect(resolveMetadata).not.toHaveBeenCalled();
  expect(relayPool.query).not.toHaveBeenCalled();

  live().onStatusChange?.('connected');
  live().onStatusChange?.('degraded');
  live().onStatusChange?.('connected');
  await dmService.pollForNotifications(self);
  expect(resolveMetadata).toHaveBeenCalledTimes(1);
  expect(relayPool.query).toHaveBeenCalledTimes(1);
});

it('retains recovery polling while history is still draining', async () => {
  mockAppState = 'active';
  jest.mocked(getSyncCursor).mockResolvedValue({ forwardSince: 1, backwardUntil: 0 });
  const backfill = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(backfill.promise);
  await dmService.init(options);
  await flush();
  jest.mocked(relayPool.hasHealthySubscription).mockReturnValue(true);
  await dmService.pollForNotifications(self);
  expect(jest.mocked(relayPool.query).mock.calls.map(([opts]) => opts.label))
    .toEqual(['dm.backfill', 'dm.notification-poll']);
  dmService.destroy();
  backfill.resolve([]);
  await flush();
});

it('refreshes routing and keys when the self-event watchers are unhealthy', async () => {
  mockAppState = 'active';
  await dmService.init(options);
  await flush();
  jest.mocked(relayPool.hasHealthySubscription).mockReturnValue(true);
  jest.mocked(selfEventStream.isHealthy).mockReturnValue(false);
  resolveMetadata.mockClear();
  await dmService.pollForNotifications(self);
  expect(resolveMetadata).toHaveBeenCalledTimes(1);
  expect(jest.mocked(relayPool.query).mock.calls.at(-1)?.[0].label).toBe('dm.notification-poll');
});


it('opens background live intake and polls without starting history, then starts on foreground entry', async () => {
  await dmService.init(options);
  await flush();
  expect(relayPool.subscribe).toHaveBeenCalled();
  expect(getSyncCursor).not.toHaveBeenCalled();
  await dmService.pollForNotifications(self);
  expect(getSyncCursor).not.toHaveBeenCalled();
  expect(jest.mocked(relayPool.query).mock.calls.map(([opts]) => opts.label))
    .toEqual(['dm.notification-poll']);
  changeAppState('active');
  await flush();
  expect(getSyncCursor).toHaveBeenCalledTimes(1);
  changeAppState('active');
  await flush();
  expect(getSyncCursor).toHaveBeenCalledTimes(1);
});

it('marks the open conversation read when the app returns to the foreground', async () => {
  await dmService.init(options);
  const markConversationAsRead = jest
    .spyOn(dmService, 'markConversationAsRead')
    .mockResolvedValue(undefined);
  dmService.setActiveConversation(self, 'conversation-a');

  returnToApp();

  expect(markConversationAsRead).toHaveBeenCalledTimes(1);
  expect(markConversationAsRead).toHaveBeenCalledWith(self, 'conversation-a');

  dmService.clearActiveConversation();
  returnToApp();
  expect(markConversationAsRead).toHaveBeenCalledTimes(1);
});

it('defers history if initialization finishes after the user backgrounds the app', async () => {
  mockAppState = 'active';
  const pending = deferred<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(pending.promise);
  const starting = dmService.init(options);
  changeAppState('background');
  pending.resolve(metadata());
  await starting;
  expect(getSyncCursor).not.toHaveBeenCalled();
  changeAppState('active');
  await flush();
  expect(getSyncCursor).toHaveBeenCalledTimes(1);
});

it('lets a foreground history pass continue paging after backgrounding', async () => {
  mockAppState = 'active';
  jest.mocked(getSyncCursor).mockResolvedValue({ forwardSince: 1, backwardUntil: 0 });
  const page = deferred<Event[]>();
  jest.mocked(relayPool.query).mockReturnValueOnce(page.promise).mockImplementationOnce(async (opts) => {
    opts.onComplete?.({ eosed: true, status: 'complete', relays: [] });
    return [];
  });
  await dmService.init(options);
  await flush();
  const first = jest.mocked(relayPool.query).mock.calls[0][0];
  const cutoff = first.filter!.until!;
  changeAppState('background');
  expect(first.abort?.aborted).toBe(false);
  page.resolve([{ id: 'history-page', kind: 1059, created_at: cutoff - 10 } as Event]);
  await flush();
  expect(relayPool.query).toHaveBeenCalledTimes(2);
  expect(jest.mocked(relayPool.query).mock.calls[1][0].filter?.until).toBe(cutoff - 10);
  expect(setForwardSince).toHaveBeenCalledWith(self, cutoff);
});

it('does not overlap history passes and uses the latest foreground cutoff on the next pass', async () => {
  mockAppState = 'active';
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try {
    jest.mocked(getSyncCursor).mockResolvedValue({ forwardSince: 1, backwardUntil: 0 });
    const page = deferred<Event[]>();
    jest.mocked(relayPool.query).mockReturnValueOnce(page.promise);
    await dmService.init(options);
    await flush();
    changeAppState('background');
    changeAppState('active');
    await flush();
    expect(getSyncCursor).toHaveBeenCalledTimes(1);
    expect(relayPool.query).toHaveBeenCalledTimes(1);
    page.resolve([]);
    await flush();
    clock.mockReturnValue(2_000_000);
    changeAppState('background');
    changeAppState('active');
    await flush();
    expect(getSyncCursor).toHaveBeenCalledTimes(2);
    expect(jest.mocked(relayPool.query).mock.calls[1][0].filter?.until).toBe(2_000);
  } finally {
    clock.mockRestore();
  }
});

it('removes user-return listeners when a receive session ends', async () => {
  await dmService.init(options);
  expect(mockAppStateListeners.size).toBe(1);
  expect(mockUserReturnedListeners.size).toBe(1);
  const staleListener = [...mockAppStateListeners][0];
  const staleUserReturnedListener = [...mockUserReturnedListeners][0];
  dmService.destroy();
  expect(mockAppStateListeners.size).toBe(0);
  expect(mockUserReturnedListeners.size).toBe(0);
  changeAppState('active');
  staleListener('active');
  staleUserReturnedListener();
  await flush();
  expect(getSyncCursor).not.toHaveBeenCalled();
});


it('invalidates the service-owned receive state and all relay work on a key change', async () => {
  await dmService.init(options);
  expect(receiveSessionStore.getState()).toEqual({ status: 'ready', accountPubkey: self });
  rotate();
  expect(receiveSessionStore.getState()).toEqual({
    status: 'key-required', accountPubkey: self, encryptionPubkey: newKey,
  });
  expect(relayPool.destroy).toHaveBeenCalledTimes(1);
  expect(selfEventStream.destroy).toHaveBeenCalled();
  dmService.destroy();
  resolveMetadata.mockClear();
  await expect(dmService.pollForNotifications(self)).rejects.toBeInstanceOf(MessagingKeySyncRequiredError);
  expect(resolveMetadata).not.toHaveBeenCalled();

  resolveMetadata.mockResolvedValue(metadata(newKey));
  jest.mocked(loadEncryptionKeys).mockResolvedValue([{ pubkey: newKey, privkey: new Uint8Array(32), createdAt: 2 }]);
  await dmService.init(options);
  expect(receiveSessionStore.getState()).toEqual({ status: 'ready', accountPubkey: self });
});

it('ignores a newer announcement that republishes the same active key', async () => {
  await dmService.init(options);
  rotate(announcement(oldKey, 30));
  expect(receiveSessionStore.getState().status).toBe('ready');
  expect(relayPool.destroy).not.toHaveBeenCalled();
});

it('stops an actual remote key change even when that key is retained locally', async () => {
  jest.mocked(loadEncryptionKeys).mockResolvedValue([
    { pubkey: oldKey, privkey: new Uint8Array(32), createdAt: 2 },
    { pubkey: newKey, privkey: new Uint8Array(32), createdAt: 1 },
  ]);
  await dmService.init(options);
  rotate();
  expect(receiveSessionStore.getState().status).toBe('key-required');
  expect(relayPool.destroy).toHaveBeenCalledTimes(1);
});

it('invalidates the live session if a recovery poll discovers a changed announcement', async () => {
  await dmService.init(options);
  resolveMetadata.mockResolvedValue({ ...metadata(newKey), announcement: announcement(newKey, 20) });
  await expect(dmService.pollForNotifications(self)).rejects.toBeInstanceOf(MessagingKeySyncRequiredError);
  expect(receiveSessionStore.getState().status).toBe('key-required');
  expect(relayPool.query).not.toHaveBeenCalled();
});

it('starts a fresh local identity from supplied metadata without a lookup or initial history, then syncs on foreground re-entry', async () => {
  changeAppState('active');
  await dmService.init({ ...options, metadata: metadata(), skipInitialHistory: true });
  expect(resolveMetadata).not.toHaveBeenCalled();
  expect(getSyncCursor).not.toHaveBeenCalled();
  expect(relayPool.subscribe).toHaveBeenCalled();
  expect(receiveSessionStore.getState().status).toBe('ready');
  changeAppState('background');
  changeAppState('active');
  await flush();
  expect(getSyncCursor).toHaveBeenCalledTimes(1);
});
