import { getPublicKey, type Event, type EventTemplate } from 'nostr-tools';

import { bytesToHex } from '@/lib/nostr/keys';

import {
  addEncryptionKey,
  exportKeyForTransfer,
  getKeySyncRelayHints,
  publishClientKeyAnnouncement,
  subscribeToKeyTransfer,
} from '../encryption-key.service';
import { nip44Encrypt } from '../../crypto/nip44';
import { relayPool } from '../../relay/relay-pool';

const mockSecureItems = new Map<string, string>();
let mockSubscribeOptions: {
  filter: Record<string, unknown>;
  onEvent: (event: Event) => void;
} | null = null;

jest.mock('../../relay/configuration-publish.service', () => ({ publishConfiguration: jest.fn() }));

jest.mock('@/platform', () => ({
  platform: {
    secureStorage: {
      getItem: jest.fn(async (key: string) => mockSecureItems.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        mockSecureItems.set(key, value);
      }),
      deleteItem: jest.fn(async (key: string) => {
        mockSecureItems.delete(key);
      }),
    },
  },
}));

jest.mock('../../crypto/nip44', () => ({
  nip44Encrypt: jest.fn(async () => 'encrypted-key'),
  nip44Decrypt: jest.fn(),
}));

jest.mock('../../relay/relay-pool', () => ({
  relayPool: {
    publishEvent: jest.fn(async () => [
      { relay: 'wss://relay.example', outcome: { ok: true } },
    ]),
    query: jest.fn(),
    subscribe: jest.fn((options) => {
      mockSubscribeOptions = options;
      return jest.fn();
    }),
  },
}));

const ACCOUNT_PUBKEY = 'a'.repeat(64);
const CLIENT_PUBKEY = 'b'.repeat(64);

function signer() {
  return {
    getPublicKey: jest.fn(async () => ACCOUNT_PUBKEY),
    signEvent: jest.fn(async (template: EventTemplate): Promise<Event> => ({
      ...template,
      id: 'c'.repeat(64),
      pubkey: ACCOUNT_PUBKEY,
      sig: 'd'.repeat(128),
    })),
  };
}

describe('encryption key transfer routing', () => {
  beforeEach(() => {
    mockSecureItems.clear();
    mockSubscribeOptions = null;
    jest.clearAllMocks();
  });

  it('advertises the exact target key and requester return relays', async () => {
    const event = await publishClientKeyAnnouncement({
      signer: signer(),
      clientPubkey: CLIENT_PUBKEY,
      relays: ['wss://relay.example'],
      expectedEncryptionPubkey: 'e'.repeat(64),
    });

    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['P', CLIENT_PUBKEY],
        ['relay', 'wss://relay.example'],
        ['n', 'e'.repeat(64)],
      ]),
    );
  });

  it('sends the exact requested retained key and routes to account plus client', async () => {
    const olderPrivkey = new Uint8Array(32).fill(1);
    const currentPrivkey = new Uint8Array(32).fill(2);
    const olderPubkey = getPublicKey(olderPrivkey);
    await addEncryptionKey(ACCOUNT_PUBKEY, bytesToHex(olderPrivkey), 100);
    await addEncryptionKey(ACCOUNT_PUBKEY, bytesToHex(currentPrivkey), 200);

    const event = await exportKeyForTransfer({
      signer: signer(),
      accountPubkey: ACCOUNT_PUBKEY,
      recipientClientPubkey: CLIENT_PUBKEY,
      relays: ['wss://relay.example'],
      requestedEncryptionPubkey: olderPubkey,
    });

    expect(nip44Encrypt).toHaveBeenCalledWith(
      bytesToHex(olderPrivkey),
      expect.any(Uint8Array),
      CLIENT_PUBKEY,
    );
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['p', ACCOUNT_PUBKEY],
        ['p', CLIENT_PUBKEY],
      ]),
    );
    expect(relayPool.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ relays: ['wss://relay.example'] }),
    );
  });

  it('normalizes and deduplicates valid reply relay hints', () => {
    const event = {
      tags: [
        ['relay', 'WSS://Relay.Example/'],
        ['relay', 'wss://relay.example'],
        ['relay', 'https://not-a-relay.example'],
      ],
    } as Event;

    expect(getKeySyncRelayHints(event)).toEqual(['wss://relay.example']);
  });

  it('matches transfer author and client while surfacing a rejected payload', async () => {
    const onRejected = jest.fn();
    subscribeToKeyTransfer({
      accountPubkey: ACCOUNT_PUBKEY,
      clientKeypair: {
        privkey: new Uint8Array(32).fill(3),
        pubkey: CLIENT_PUBKEY,
        createdAt: 100,
      },
      relays: ['wss://relay.example'],
      signer: signer(),
      expectedEncryptionPubkey: 'e'.repeat(64),
      onTransfer: jest.fn(),
      onRejected,
    });

    expect(mockSubscribeOptions?.filter).toEqual({
      kinds: [4455],
      authors: [ACCOUNT_PUBKEY],
      '#p': [CLIENT_PUBKEY],
    });
    mockSubscribeOptions?.onEvent({
      id: 'f'.repeat(64),
      pubkey: ACCOUNT_PUBKEY,
      created_at: 100,
      kind: 4455,
      tags: [
        ['P', '1'.repeat(64)],
        ['p', ACCOUNT_PUBKEY],
        ['p', CLIENT_PUBKEY],
      ],
      content: 'invalid',
      sig: '2'.repeat(128),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onRejected).toHaveBeenCalledTimes(1);
  });
});
