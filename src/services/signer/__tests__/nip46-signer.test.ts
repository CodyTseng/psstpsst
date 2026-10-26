import type { Event, EventTemplate } from 'nostr-tools';
import type { BunkerPointer } from 'nostr-tools/nip46';

import { Nip46Signer } from '../nip46-signer';
import { NIP46_REQUEST_TIMEOUT_MS } from '../nip46-timeout';

const mockFromBunker = jest.fn();

jest.mock('nostr-tools/nip46', () => ({
  BunkerSigner: {
    fromBunker: (...args: unknown[]) => mockFromBunker(...args),
  },
}));

jest.mock('@/platform', () => ({
  platform: {
    urlOpener: { openExternalUrl: jest.fn(async () => {}) },
  },
}));

jest.mock('@/services/relay/relay-pool', () => ({
  relayPool: { underlyingPool: {} },
}));

const TEMPLATE: EventTemplate = { kind: 1, content: '', tags: [], created_at: 1 };
const EVENT = {
  ...TEMPLATE,
  id: 'id',
  pubkey: 'pubkey',
  sig: 'sig',
} as Event;
const POINTER = {
  pubkey: 'bunker',
  relays: ['wss://relay.example/'],
  secret: null,
} as BunkerPointer;

type MockBunker = {
  connect: jest.Mock;
  close: jest.Mock;
  getPublicKey: jest.Mock;
  signEvent: jest.Mock;
  nip44Encrypt: jest.Mock;
  nip44Decrypt: jest.Mock;
};

function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function createBunker(overrides: Partial<MockBunker> = {}): MockBunker {
  return {
    connect: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    getPublicKey: jest.fn(async () => 'pubkey'),
    signEvent: jest.fn(async () => EVENT),
    nip44Encrypt: jest.fn(async () => 'ciphertext'),
    nip44Decrypt: jest.fn(async () => 'plaintext'),
    ...overrides,
  };
}

function createSigner(): Nip46Signer {
  return new Nip46Signer(new Uint8Array(32), POINTER);
}

describe('Nip46Signer request bounds', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-30T05:00:00.000Z'));
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFromBunker.mockReset();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  test('normalizes persisted bunker relays before reconnecting', async () => {
    mockFromBunker.mockReturnValue(createBunker());
    const pointer = { ...POINTER, relays: ['https://RELAY.example//?b=2&a=1#fragment', 'wss://relay.example/?a=1&b=2'] };
    const signer = new Nip46Signer(new Uint8Array(32), pointer);
    await signer.getPublicKey();
    expect(mockFromBunker).toHaveBeenCalledWith(expect.any(Uint8Array), {
      ...POINTER, relays: ['wss://relay.example/?a=1&b=2'],
    }, expect.any(Object));
    expect(pointer.relays).toHaveLength(2);
    await signer.destroy();
  });

  test('keeps credentials and the connected bunker out of public properties', async () => {
    const bunker = createBunker();
    mockFromBunker.mockReturnValue(bunker);
    const input = new Uint8Array(32).fill(1);
    const pointer = { ...POINTER, relays: [...POINTER.relays], secret: 'connection-secret' };
    const signer = new Nip46Signer(input, pointer);
    input.fill(0);
    pointer.secret = 'replaced-secret';
    pointer.relays.length = 0;

    await signer.getPublicKey();

    expect(mockFromBunker).toHaveBeenCalledWith(new Uint8Array(32).fill(1), {
      ...POINTER, secret: 'connection-secret',
    }, expect.any(Object));
    expect(Reflect.ownKeys(signer)).toEqual([]);
    expect(JSON.stringify(signer)).toBe('{}');
    expect(Reflect.get(signer, 'ensureConnected')).toBeUndefined();
    await signer.destroy();
  });

  test('times out a stalled connection and reconnects on the next request', async () => {
    const stalled = createBunker({ connect: jest.fn(() => pending<void>()) });
    const recovered = createBunker();
    mockFromBunker.mockReturnValueOnce(stalled).mockReturnValueOnce(recovered);
    const signer = createSigner();

    const first = signer.signEvent(TEMPLATE);
    const firstResult = expect(first).rejects.toThrow(
      'NIP-46 connection timed out after 60 seconds.',
    );
    await jest.advanceTimersByTimeAsync(NIP46_REQUEST_TIMEOUT_MS);
    await firstResult;

    expect(warnSpy).toHaveBeenCalledWith(
      '[nip46] connection timed out after 60000ms at 2026-08-30T05:01:00.000Z.',
    );
    expect(stalled.close).toHaveBeenCalledTimes(1);
    await expect(signer.signEvent(TEMPLATE)).resolves.toBe(EVENT);
    expect(mockFromBunker).toHaveBeenCalledTimes(2);
  });

  test('times out a stalled signing request and discards the cached session', async () => {
    const stalled = createBunker({ signEvent: jest.fn(() => pending<Event>()) });
    const recovered = createBunker();
    mockFromBunker.mockReturnValueOnce(stalled).mockReturnValueOnce(recovered);
    const signer = createSigner();

    const first = signer.signEvent(TEMPLATE);
    const firstResult = expect(first).rejects.toThrow(
      'NIP-46 sign_event timed out after 60 seconds.',
    );
    await jest.advanceTimersByTimeAsync(NIP46_REQUEST_TIMEOUT_MS);
    await firstResult;

    expect(warnSpy).toHaveBeenCalledWith(
      '[nip46] sign_event timed out after 60000ms at 2026-08-30T05:01:00.000Z.',
    );
    expect(stalled.close).toHaveBeenCalledTimes(1);
    await expect(signer.signEvent(TEMPLATE)).resolves.toBe(EVENT);
    expect(mockFromBunker).toHaveBeenCalledTimes(2);
  });

  test('destroy permanently ends the instance without allowing reconnection', async () => {
    const bunker = createBunker(); mockFromBunker.mockReturnValue(bunker);
    const signer = createSigner();
    await signer.getPublicKey(); await signer.destroy();
    await expect(signer.getPublicKey()).rejects.toThrow('destroyed');
    expect(mockFromBunker).toHaveBeenCalledTimes(1);
    expect(bunker.close).toHaveBeenCalledTimes(1);
  });

  test('discards an operation result completed after destruction', async () => {
    let finish!: (event: Event) => void;
    const bunker = createBunker({ signEvent: jest.fn(() => new Promise<Event>(resolve => { finish = resolve; })) });
    mockFromBunker.mockReturnValue(bunker);
    const signer = createSigner(); await signer.getPublicKey();
    const work = signer.signEvent(TEMPLATE);
    const rejected = expect(work).rejects.toThrow('destroyed');
    await jest.advanceTimersByTimeAsync(0);
    await signer.destroy(); finish(EVENT); await rejected;
  });

  test('reuses a healthy bunker session across bounded operations', async () => {
    const bunker = createBunker();
    mockFromBunker.mockReturnValue(bunker);
    const signer = createSigner();

    await expect(signer.getPublicKey()).resolves.toBe('pubkey');
    await expect(signer.nip44Encrypt('peer', 'message')).resolves.toBe('ciphertext');
    await expect(signer.nip44Decrypt('peer', 'ciphertext')).resolves.toBe('plaintext');

    expect(mockFromBunker).toHaveBeenCalledTimes(1);
    expect(bunker.connect).toHaveBeenCalledTimes(1);
  });
});
