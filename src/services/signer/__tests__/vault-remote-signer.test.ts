import { generateSecretKey, getPublicKey, verifyEvent, type Event, type EventTemplate } from 'nostr-tools';
import { createVaultRemoteSigner } from '../vault-remote-signer';
import { NIP46_REQUEST_TIMEOUT_MS } from '../nip46-timeout';
jest.mock('@/platform/vault-access', () => ({ vaultAccess: jest.requireMock('@/platform').platform.keyVault }));

const mockState: {
  client: Uint8Array; bunker: Uint8Array; identity: Uint8Array;
  listener?: (event: Event) => void; requests: string[]; stalled: boolean; substitute: boolean;
} = { client: new Uint8Array(), bunker: new Uint8Array(), identity: new Uint8Array(), requests: [], stalled: false, substitute: false };
const clientPubkey = () => getPublicKey(mockState.client);
const bunkerPubkey = () => getPublicKey(mockState.bunker);
const identityPubkey = () => getPublicKey(mockState.identity);

jest.mock('@/i18n/core', () => ({ __esModule: true, default: { language: 'en' } }));
jest.mock('@/platform', () => ({ platform: {
  deviceCrypto: { randomUUID: jest.fn(async () => String(Math.random())) },
  urlOpener: { openExternalUrl: jest.fn(async () => {}) },
  keyVault: { execute: jest.fn(async (command) => {
    const tools = jest.requireActual('nostr-tools') as typeof import('nostr-tools');
    const pub = tools.getPublicKey(mockState.bunker);
    const conversation = tools.nip44.v2.utils.getConversationKey(mockState.client, pub);
    if (command.method === 'publicKey') return tools.getPublicKey(mockState.client);
    if (command.method === 'crypto') return tools.nip44.v2.decrypt(command.text, conversation);
    if (command.method !== 'bunkerRequest') throw new Error('Unexpected vault operation');
    return tools.finalizeEvent({ kind: 24133, created_at: 1, tags: [['p', pub]],
      content: tools.nip44.v2.encrypt(JSON.stringify({ id: command.id, method: command.operation,
        params: command.operation === 'connect' ? [pub, 'credential'] : command.params }), conversation),
    }, mockState.client);
  }) },
} }));
jest.mock('../../relay/managed-relay-pool', () => ({ ManagedRelayPool: jest.fn(() => ({
  subscribe: (options: { onEvent(event: Event): void }) => {
    mockState.listener = options.onEvent;
    return () => { mockState.listener = undefined; };
  },
  underlyingPool: { publish: (_relays: string[], event: Event) => {
    const tools = jest.requireActual('nostr-tools') as typeof import('nostr-tools');
    if (!tools.verifyEvent(event)) throw new Error('Invalid client signature');
    const conversation = tools.nip44.v2.utils.getConversationKey(mockState.bunker, event.pubkey);
    const request = JSON.parse(tools.nip44.v2.decrypt(event.content, conversation));
    mockState.requests.push(request.method);
    if (!mockState.stalled) {
      let result = 'ciphertext';
      if (request.method === 'connect') result = 'ack';
      else if (request.method === 'get_public_key') result = tools.getPublicKey(mockState.identity);
      else if (request.method === 'sign_event') {
        const template = JSON.parse(request.params[0]);
        if (mockState.substitute) template.content = 'substituted';
        result = JSON.stringify(tools.finalizeEvent(template, mockState.identity));
      }
      const response = tools.finalizeEvent({ kind: 24133, created_at: 1, tags: [['p', event.pubkey]],
        content: tools.nip44.v2.encrypt(JSON.stringify({ id: request.id, result }), conversation),
      }, mockState.bunker);
      void Promise.resolve().then(() => mockState.listener?.(response));
    }
    return [Promise.resolve('ok')];
  } },
  destroy: jest.fn(),
})) }));

beforeEach(() => {
  mockState.client = generateSecretKey(); mockState.bunker = generateSecretKey(); mockState.identity = generateSecretKey();
  mockState.requests = []; mockState.listener = undefined; mockState.stalled = false; mockState.substitute = false;
});
afterEach(() => jest.useRealTimers());
const template: EventTemplate = { kind: 1, created_at: 100, tags: [], content: 'hello' };
const signer = () => createVaultRemoteSigner(identityPubkey(), { pubkey: bunkerPubkey(), relays: ['wss://relay.example/'], secret: null });

test('handshakes and signs over the account client identity while keeping the transport opaque', async () => {
  const remote = signer();
  expect(await remote.getPublicKey()).toBe(identityPubkey());
  const event = await remote.signEvent(template);
  expect(verifyEvent(event)).toBe(true); expect(event.pubkey).toBe(identityPubkey());
  expect(await remote.nip44Encrypt!(clientPubkey(), 'hello')).toBe('ciphertext');
  expect(mockState.requests).toEqual(['connect', 'get_public_key', 'sign_event', 'nip44_encrypt']);
  expect(JSON.stringify(remote)).toBe('{}');
  await remote.destroy?.(); await expect(remote.getPublicKey()).rejects.toThrow('destroyed');
});

test('rejects a valid signature over a substituted template', async () => {
  const remote = signer(); mockState.substitute = true;
  await expect(remote.signEvent(template)).rejects.toThrow('Invalid bunker signature');
  await remote.destroy?.();
});

test('a request timeout discards the connection and the next operation reconnects', async () => {
  jest.useFakeTimers(); const remote = signer(); await remote.getPublicKey();
  mockState.stalled = true;
  const pending = remote.nip44Encrypt!(clientPubkey(), 'hello');
  const rejected = expect(pending).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(NIP46_REQUEST_TIMEOUT_MS); await rejected;
  mockState.stalled = false;
  expect(await remote.getPublicKey()).toBe(identityPubkey());
  expect(mockState.requests.filter(value => value === 'connect')).toHaveLength(2);
  await remote.destroy?.();
});
