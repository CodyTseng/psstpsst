import type { Event, EventTemplate } from 'nostr-tools';
import { BunkerSigner, type BunkerPointer } from 'nostr-tools/nip46';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';

import { platform } from '@/platform';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { relayPool } from '../relay/relay-pool';
import type { Signer } from './signer.interface';
import { Nip46TimeoutError, withNip46Timeout } from './nip46-timeout';

/**
 * When the bunker needs the user to approve a request, it answers with an
 * `auth_url`. Open it so the user can grant the permission in their signer's
 * web/app surface; the original request then completes once approved.
 */
function openAuthUrl(url: string): void {
  void platform.urlOpener.openExternalUrl(url).catch((error) => {
    console.warn('[nip46] Failed to open the authorization URL.', error);
  });
}

type SignerState = {
  inner: BunkerSigner | null;
  connecting: Promise<BunkerSigner> | null;
  connectionGeneration: number;
  clientSecretKey: Uint8Array;
  pointer: BunkerPointer;
  transport: AbstractSimplePool;
  destroyed: boolean;
};

// Neither credentials nor helpers returning the bunker are instance properties.
const states = new WeakMap<Nip46Signer, SignerState>();

function stateFor(signer: Nip46Signer): SignerState {
  const state = states.get(signer);
  if (!state) throw new Error('Invalid NIP-46 signer');
  return state;
}

/** Build the bunker signer and complete the handshake once; concurrent callers
 * share the in-flight promise. A failed connect clears the cache so a later
 * call can retry. */
function ensureConnected(state: SignerState): Promise<BunkerSigner> {
  if (state.destroyed) return Promise.reject(new Error('Signer has been destroyed'));
  if (state.inner) return Promise.resolve(state.inner);
  if (state.connecting) return state.connecting;
  const generation = ++state.connectionGeneration;
  const pointer = {
    ...state.pointer,
    relays: Array.from(new Set(state.pointer.relays.map(normalizeRelayUrl))),
  };
  const signer = BunkerSigner.fromBunker(state.clientSecretKey, pointer, {
    pool: state.transport,
    onauth: openAuthUrl,
  });
  const pending = (async () => {
    try {
      await withNip46Timeout(signer.connect(), 'connection');
      if (state.connectionGeneration !== generation) {
        throw new Error('NIP-46 connection was superseded.');
      }
      state.inner = signer;
      return signer;
    } catch (error) {
      await signer.close().catch(() => {});
      throw error;
    }
  })();
  void pending.finally(() => {
    if (state.connecting === pending) state.connecting = null;
  }).catch(() => {});
  state.connecting = pending;
  return pending;
}

async function request<T>(
  state: SignerState,
  operation: string,
  run: (signer: BunkerSigner) => Promise<T>,
): Promise<T> {
  const signer = await ensureConnected(state);
  try {
    if (state.destroyed) throw new Error('Signer has been destroyed');
    const result = await withNip46Timeout(run(signer), operation);
    if (state.destroyed) throw new Error('Signer has been destroyed');
    return result;
  } catch (error) {
    if (error instanceof Nip46TimeoutError) await discard(state, signer);
    throw error;
  }
}

async function discard(state: SignerState, signer: BunkerSigner): Promise<void> {
  if (state.inner === signer) {
    state.inner = null;
    state.connectionGeneration += 1;
  }
  await signer.close().catch(() => {});
}

/**
 * NIP-46 remote signer (bunker). Wraps nostr-tools' `BunkerSigner` — which
 * already speaks the kind-24133 request/response protocol over a relay and
 * implements NIP-44 — and adapts it to our {@link Signer} interface.
 *
 * The bunker connection (relay subscription + handshake) is established **lazily
 * on first use** and memoised, so constructing a signer during bootstrap is
 * cheap and we only pay the round-trip when something actually needs signing.
 * Every method is a network round-trip to the remote signer; nothing here
 * touches a local private key (there is none for a remote account).
 */
export class Nip46Signer implements Signer {
  constructor(
    clientSecretKey: Uint8Array,
    pointer: BunkerPointer,
    transport: AbstractSimplePool = relayPool.underlyingPool,
  ) {
    states.set(this, {
      destroyed: false,
      inner: null,
      connecting: null,
      connectionGeneration: 0,
      clientSecretKey: new Uint8Array(clientSecretKey),
      pointer: { ...pointer, relays: [...pointer.relays] },
      transport,
    });
  }

  async getPublicKey(): Promise<string> {
    return request(stateFor(this), 'get_public_key', (signer) => signer.getPublicKey());
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return request(stateFor(this), 'sign_event', (signer) => signer.signEvent(template));
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return request(stateFor(this), 'nip44_encrypt', (signer) =>
      signer.nip44Encrypt(peerPubkey, plaintext),
    );
  }

  async nip04Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return request(stateFor(this), 'nip04_encrypt', signer => signer.nip04Encrypt(peerPubkey, plaintext));
  }

  async nip04Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return request(stateFor(this), 'nip04_decrypt', signer => signer.nip04Decrypt(peerPubkey, ciphertext));
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return request(stateFor(this), 'nip44_decrypt', (signer) =>
      signer.nip44Decrypt(peerPubkey, ciphertext),
    );
  }

  async destroy(): Promise<void> {
    const state = stateFor(this);
    if (state.destroyed) return;
    state.destroyed = true;
    state.clientSecretKey.fill(0);
    state.pointer.secret = null;
    const inner = state.inner;
    state.inner = null;
    state.connecting = null;
    state.connectionGeneration += 1;
    await inner?.close().catch(() => {});
  }
}
