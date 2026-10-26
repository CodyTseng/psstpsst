import { vaultAccess } from '@/platform/vault-access';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent, type Event } from 'nostr-tools';
// eslint-disable-next-line no-restricted-imports -- Integration tests run the trusted backend in place of the native bridge.
import { LocalKeyVault } from '@/platform/vault/local-vault';
import type { VaultCommand } from '@/platform/ports/key-vault';
import { loginWithBunker, startNostrConnect } from '../nip46-connect.service';
import { NIP46_PAIRING_TIMEOUT_MS } from '../nip46-timeout';
jest.mock('@/platform/vault-access', () => ({ vaultAccess: jest.requireMock('@/platform').platform.keyVault }));

const mockState: {
  vault: LocalKeyVault; bunker: Uint8Array; account: string;
  listener?: (event: Event) => void; stalled: boolean; rejected: boolean;
  requests: string[]; commands: VaultCommand[];
} = {} as never;

jest.mock('@/platform', () => ({ platform: {
  urlOpener: { openExternalUrl: jest.fn(async () => {}) },
  keyVault: { execute: jest.fn((command: VaultCommand) => {
    mockState.commands.push(command);
    return mockState.vault.execute(command);
  }) },
} }));
jest.mock('../../account/account.service', () => ({ addRemoteAccount: async (session: string) => {
  const paired = await mockState.vault.execute({ method: 'commitBunkerPairing', session }) as { pubkey: string };
  return { pubkey: paired.pubkey };
} }));
jest.mock('../../relay/managed-relay-pool', () => ({ ManagedRelayPool: jest.fn(() => ({
  subscribe: (options: { onEvent(event: Event): void }) => {
    mockState.listener = options.onEvent;
    return () => { mockState.listener = undefined; };
  },
  underlyingPool: { publish: (_relays: string[], event: Event) => {
    const tools = jest.requireActual('nostr-tools') as typeof import('nostr-tools');
    if (!tools.verifyEvent(event)) throw new Error('Invalid pairing signature');
    const conversation = tools.nip44.v2.utils.getConversationKey(mockState.bunker, event.pubkey);
    const request = JSON.parse(tools.nip44.v2.decrypt(event.content, conversation));
    mockState.requests.push(request.method);
    if (!mockState.stalled) {
      const result = request.method === 'connect' ? 'ack' : mockState.account;
      const response = tools.finalizeEvent({ kind: 24133, created_at: 1, tags: [['p', event.pubkey]],
        content: tools.nip44.v2.encrypt(JSON.stringify(mockState.rejected
          ? { id: request.id, error: 'denied' } : { id: request.id, result }), conversation),
      }, mockState.bunker);
      void Promise.resolve().then(() => mockState.listener?.(response));
    }
    return [Promise.resolve('ok')];
  } },
  destroy: jest.fn(),
})) }));

beforeEach(() => {
  const storage = new Map<string, string>();
  mockState.vault = new LocalKeyVault({
    getItem: async key => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
    deleteItem: async key => { storage.delete(key); },
  });
  mockState.bunker = generateSecretKey(); mockState.account = getPublicKey(generateSecretKey());
  mockState.listener = undefined; mockState.stalled = false; mockState.rejected = false;
  mockState.requests = []; mockState.commands = [];
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('bunker URI login completes the sealed handshake and retains the generated client', async () => {
  expect(await loginWithBunker(`bunker://${getPublicKey(mockState.bunker)}?relay=wss%3A%2F%2Frelay.example%2F&secret=credential`))
    .toEqual({ pubkey: mockState.account });
  expect(mockState.requests).toEqual(['connect', 'get_public_key']);
  expect(mockState.commands.some(command => command.method === 'cancelBunkerPairing')).toBe(true);
  const client = await mockState.vault.execute({ method: 'publicKey', key: { account: mockState.account, role: 'nip46-client' } });
  expect(client).toMatch(/^[0-9a-f]{64}$/);
});

test('reverse pairing subscribes before exposing the invitation and verifies discovery before connecting', async () => {
  const session = await startNostrConnect({ relays: ['wss://relay.example/'] });
  expect(mockState.listener).toBeDefined(); expect(mockState.requests).toEqual([]);
  const uri = new URL(session.uri);
  const discovery = finalizeEvent({ kind: 24133, created_at: 1, tags: [['p', uri.hostname]],
    content: nip44.v2.encrypt(JSON.stringify({ id: 'discovery', result: uri.searchParams.get('secret') }),
      nip44.v2.utils.getConversationKey(mockState.bunker, uri.hostname)),
  }, mockState.bunker);
  expect(verifyEvent(discovery)).toBe(true);
  mockState.listener!(discovery);
  expect(await session.waitForConnection()).toEqual({ pubkey: mockState.account });
  expect(mockState.requests).toEqual(['connect', 'get_public_key']);
});

test('cancelling a reverse invitation releases the native session and relay subscription', async () => {
  const session = await startNostrConnect();
  session.cancel();
  await expect(session.waitForConnection()).rejects.toThrow('session ended');
  expect(mockState.listener).toBeUndefined();
  const cancellation = mockState.commands.find(command => command.method === 'cancelBunkerPairing')!;
  if (cancellation.method !== 'cancelBunkerPairing') throw new Error('Missing cancellation');
  await expect(vaultAccess.execute({ method: 'commitBunkerPairing', session: cancellation.session })).rejects.toThrow();
});

test('a rejected pairing fails immediately and clears its session', async () => {
  mockState.rejected = true;
  await expect(loginWithBunker(`bunker://${getPublicKey(mockState.bunker)}?relay=wss%3A%2F%2Frelay.example%2F`))
    .rejects.toThrow('Bunker rejected pairing');
  expect(mockState.listener).toBeUndefined();
  expect(mockState.requests).toEqual(['connect']);
});

test('an unanswered reverse invitation times out and releases its session', async () => {
  jest.useFakeTimers(); jest.spyOn(console, 'warn').mockImplementation(() => {});
  const session = await startNostrConnect();
  const rejected = expect(session.waitForConnection()).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(NIP46_PAIRING_TIMEOUT_MS);
  await rejected;
  expect(mockState.listener).toBeUndefined();
  expect(mockState.commands.some(command => command.method === 'cancelBunkerPairing')).toBe(true);
});
