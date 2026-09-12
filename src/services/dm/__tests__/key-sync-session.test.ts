import type { Event } from 'nostr-tools';

import {
  classifyKeySyncRequest,
  isKeySyncRequestResolvedByTransfer,
  KeySyncSession,
  type KeySyncSessionDependencies,
} from '../key-sync-session';

jest.mock('@/services/account/account.service', () => ({
  buildSigner: jest.fn(),
  getAccount: jest.fn(),
}));
jest.mock('@/services/dm/encryption-key.service', () => ({
  generateClientKeypair: jest.fn(),
  getClientPubkeyFromEvent: jest.fn((event: { tags: string[][] }) =>
    event.tags.find((tag) => tag[0] === 'P')?.[1] ??
    event.tags.find((tag) => tag[0] === 'pubkey')?.[1] ??
    null,
  ),
  getEncryptionPubkeyFromEvent: jest.fn(),
  getVerificationCode: jest.fn(),
  publishClientKeyAnnouncement: jest.fn(),
  queryEncryptionKeyAnnouncement: jest.fn(),
  subscribeToKeyTransfer: jest.fn(),
}));
jest.mock('@/services/dm/sync-store', () => ({
  markSyncRequestProcessed: jest.fn(),
}));
jest.mock('@/services/relay/relay-list.service', () => ({
  ownKeyAnnouncementRelays: jest.fn(),
  ownKeyTransferRelays: jest.fn(),
}));

const ACCOUNT_PUBKEY = 'a'.repeat(64);
const CLIENT_PUBKEY = 'b'.repeat(64);
const ENCRYPTION_PUBKEY = 'c'.repeat(64);
const KEY_TRANSFER_RELAYS = ['wss://dm.example', 'wss://write.example'];

function event(id: string): Event {
  return {
    id: id.padEnd(64, '0'),
    pubkey: ACCOUNT_PUBKEY,
    created_at: 100,
    kind: 4454,
    tags: [],
    content: '',
    sig: 'd'.repeat(128),
  };
}

function requestEvent(id: string, clientPubkey: string): Event {
  return {
    ...event(id),
    tags: [['P', clientPubkey]],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !predicate(); i += 1) await Promise.resolve();
}

function harness() {
  const signer = {
    getPublicKey: jest.fn(async () => ACCOUNT_PUBKEY),
    signEvent: jest.fn(),
  };
  const clientKeypair = {
    privkey: new Uint8Array(32).fill(1),
    pubkey: CLIENT_PUBKEY,
    createdAt: 100,
  };
  const unsubscribe = jest.fn();
  let transfer: (() => void) | null = null;
  let rejectTransfer: (() => void) | null = null;
  const publishClientKeyAnnouncement = jest.fn();
  const markSyncRequestProcessed = jest.fn(async () => {});
  const subscribeToKeyTransfer = jest.fn((options: {
    onTransfer: () => void;
    onRejected?: () => void;
  }) => {
    transfer = options.onTransfer;
    rejectTransfer = options.onRejected ?? null;
    return unsubscribe;
  });
  const dependencies = {
    buildSigner: jest.fn(async () => signer),
    getAccount: jest.fn(async () => ({ encryptionPubkey: ENCRYPTION_PUBKEY })),
    generateClientKeypair: jest.fn(() => clientKeypair),
    getEncryptionPubkeyFromEvent: jest.fn(() => ENCRYPTION_PUBKEY),
    getVerificationCode: jest.fn(() => 'PAIR CODE'),
    markSyncRequestProcessed,
    ownKeyAnnouncementRelays: jest.fn(async () => ['wss://relay.example']),
    ownKeyTransferRelays: jest.fn(async () => KEY_TRANSFER_RELAYS),
    publishClientKeyAnnouncement,
    queryEncryptionKeyAnnouncement: jest.fn(async () => event('announcement')),
    subscribeToKeyTransfer,
  } as unknown as KeySyncSessionDependencies;

  return {
    dependencies,
    publishClientKeyAnnouncement,
    markSyncRequestProcessed,
    subscribeToKeyTransfer,
    unsubscribe,
    getTransfer: () => transfer,
    getRejectTransfer: () => rejectTransfer,
  };
}

describe('KeySyncSession', () => {
  it('distinguishes a retry from a replacement requester session', () => {
    const current = requestEvent('current', CLIENT_PUBKEY);

    expect(classifyKeySyncRequest(null, current)).toBe('accept');
    expect(classifyKeySyncRequest(current, requestEvent('retry', CLIENT_PUBKEY))).toBe(
      'duplicate',
    );
    expect(
      classifyKeySyncRequest(current, requestEvent('replacement', 'f'.repeat(64))),
    ).toBe('replace');
  });

  it('recognizes a transfer that fulfills the exact requester client key', () => {
    const request = requestEvent('request', CLIENT_PUBKEY);
    const matchingTransfer = {
      ...event('transfer'),
      kind: 4455,
      tags: [
        ['P', 'e'.repeat(64)],
        ['p', ACCOUNT_PUBKEY],
        ['p', CLIENT_PUBKEY],
      ],
    };

    expect(isKeySyncRequestResolvedByTransfer(request, matchingTransfer)).toBe(true);
    expect(
      isKeySyncRequestResolvedByTransfer(
        request,
        { ...matchingTransfer, tags: [['p', ACCOUNT_PUBKEY], ['p', 'f'.repeat(64)]] },
      ),
    ).toBe(false);
  });

  it('shares concurrent work and reuses one client key and subscription on retry', async () => {
    const h = harness();
    const firstPublish = deferred<Event>();
    h.publishClientKeyAnnouncement
      .mockImplementationOnce(() => firstPublish.promise)
      .mockResolvedValueOnce(event('second'));
    const onCode = jest.fn();
    const session = new KeySyncSession(
      { accountPubkey: ACCOUNT_PUBKEY, onCode, onTransfer: jest.fn() },
      h.dependencies,
    );

    const first = session.request();
    const concurrent = session.request();

    expect(concurrent).toBe(first);
    await flushUntil(() => h.publishClientKeyAnnouncement.mock.calls.length === 1);
    expect(h.publishClientKeyAnnouncement).toHaveBeenCalledTimes(1);

    firstPublish.resolve(event('first'));
    await Promise.all([first, concurrent]);
    await session.request();

    expect(onCode).toHaveBeenCalledTimes(1);
    expect(h.subscribeToKeyTransfer).toHaveBeenCalledTimes(1);
    expect(h.publishClientKeyAnnouncement).toHaveBeenCalledTimes(2);
    expect(h.publishClientKeyAnnouncement.mock.calls[0][0].clientPubkey).toBe(
      CLIENT_PUBKEY,
    );
    expect(h.publishClientKeyAnnouncement.mock.calls[1][0].clientPubkey).toBe(
      CLIENT_PUBKEY,
    );
    expect(h.publishClientKeyAnnouncement.mock.calls[0][0]).toMatchObject({
      relays: KEY_TRANSFER_RELAYS,
      expectedEncryptionPubkey: ENCRYPTION_PUBKEY,
    });
    expect(h.subscribeToKeyTransfer.mock.calls[0][0]).toMatchObject({
      relays: KEY_TRANSFER_RELAYS,
    });
    expect(h.markSyncRequestProcessed).toHaveBeenCalledTimes(2);
  });

  it('closes the durable subscription after a matching transfer', async () => {
    const h = harness();
    h.publishClientKeyAnnouncement.mockResolvedValue(event('request'));
    const onTransfer = jest.fn();
    const session = new KeySyncSession(
      { accountPubkey: ACCOUNT_PUBKEY, onCode: jest.fn(), onTransfer },
      h.dependencies,
    );
    await session.request();

    h.getTransfer()?.();

    expect(onTransfer).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    await expect(session.request()).rejects.toThrow('closed');
  });

  it('keeps the same transport when a publish fails and is retried', async () => {
    const h = harness();
    h.publishClientKeyAnnouncement
      .mockRejectedValueOnce(new Error('no relay accepted'))
      .mockResolvedValueOnce(event('retry'));
    const session = new KeySyncSession(
      { accountPubkey: ACCOUNT_PUBKEY, onCode: jest.fn(), onTransfer: jest.fn() },
      h.dependencies,
    );

    await expect(session.request()).rejects.toThrow('no relay accepted');
    await session.request();

    expect(h.subscribeToKeyTransfer).toHaveBeenCalledTimes(1);
    expect(h.publishClientKeyAnnouncement).toHaveBeenCalledTimes(2);
    expect(h.publishClientKeyAnnouncement.mock.calls[0][0].clientPubkey).toBe(
      CLIENT_PUBKEY,
    );
    expect(h.publishClientKeyAnnouncement.mock.calls[1][0].clientPubkey).toBe(
      CLIENT_PUBKEY,
    );
    expect(h.markSyncRequestProcessed).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rejected transfer without closing the session', async () => {
    const h = harness();
    h.publishClientKeyAnnouncement.mockResolvedValue(event('request'));
    const onRejected = jest.fn();
    const session = new KeySyncSession(
      {
        accountPubkey: ACCOUNT_PUBKEY,
        onCode: jest.fn(),
        onTransfer: jest.fn(),
        onRejected,
      },
      h.dependencies,
    );
    await session.request();

    h.getRejectTransfer()?.();

    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).not.toHaveBeenCalled();
    await session.request();
    expect(h.publishClientKeyAnnouncement).toHaveBeenCalledTimes(2);
  });

  it('does not install a subscription when closed during initialization', async () => {
    const h = harness();
    const signerReady = deferred<unknown>();
    (h.dependencies.buildSigner as jest.Mock).mockImplementation(() => signerReady.promise);
    const session = new KeySyncSession(
      { accountPubkey: ACCOUNT_PUBKEY, onCode: jest.fn(), onTransfer: jest.fn() },
      h.dependencies,
    );

    const request = session.request();
    session.close();
    signerReady.resolve({ getPublicKey: jest.fn(), signEvent: jest.fn() });

    await expect(request).rejects.toThrow('closed');
    expect(h.subscribeToKeyTransfer).not.toHaveBeenCalled();
    expect(h.publishClientKeyAnnouncement).not.toHaveBeenCalled();
  });
});
