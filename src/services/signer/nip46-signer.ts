import type { Event, EventTemplate } from 'nostr-tools';
import { BunkerSigner, type BunkerPointer } from 'nostr-tools/nip46';

import { platform } from '@/platform';

import { relayPool } from '../relay/relay-pool';
import type { Signer } from './signer.interface';
import { Nip46TimeoutError, withNip46Timeout } from './nip46-timeout';

/**
 * When the bunker needs the user to approve a request, it answers with an
 * `auth_url`. Open it so the user can grant the permission in their signer's
 * web/app surface; the original request then completes once approved.
 */
function openAuthUrl(url: string): void {
  void platform.urlOpener.openExternalUrl(url);
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
  private inner: BunkerSigner | null = null;
  private connecting: Promise<BunkerSigner> | null = null;
  private connectionGeneration = 0;

  constructor(
    private readonly clientSecretKey: Uint8Array,
    private readonly pointer: BunkerPointer,
  ) {}

  /** Build the bunker signer and complete the handshake once; concurrent callers
   * share the in-flight promise. A failed connect clears the cache so a later
   * call can retry. */
  private ensureConnected(): Promise<BunkerSigner> {
    if (this.inner) return Promise.resolve(this.inner);
    if (this.connecting) return this.connecting;
    const generation = ++this.connectionGeneration;
    const signer = BunkerSigner.fromBunker(this.clientSecretKey, this.pointer, {
      pool: relayPool.underlyingPool,
      onauth: openAuthUrl,
    });
    const pending = (async () => {
      try {
        await withNip46Timeout(signer.connect(), 'connection');
        if (this.connectionGeneration !== generation) {
          throw new Error('NIP-46 connection was superseded.');
        }
        this.inner = signer;
        return signer;
      } catch (error) {
        await signer.close().catch(() => {});
        throw error;
      }
    })();
    void pending.finally(() => {
      if (this.connecting === pending) this.connecting = null;
    }).catch(() => {});
    this.connecting = pending;
    return pending;
  }

  private async request<T>(
    operation: string,
    run: (signer: BunkerSigner) => Promise<T>,
  ): Promise<T> {
    const signer = await this.ensureConnected();
    try {
      return await withNip46Timeout(run(signer), operation);
    } catch (error) {
      if (error instanceof Nip46TimeoutError) await this.discard(signer);
      throw error;
    }
  }

  private async discard(signer: BunkerSigner): Promise<void> {
    if (this.inner === signer) {
      this.inner = null;
      this.connectionGeneration += 1;
    }
    await signer.close().catch(() => {});
  }

  async getPublicKey(): Promise<string> {
    return this.request('get_public_key', (signer) => signer.getPublicKey());
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return this.request('sign_event', (signer) => signer.signEvent(template));
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return this.request('nip44_encrypt', (signer) =>
      signer.nip44Encrypt(peerPubkey, plaintext),
    );
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return this.request('nip44_decrypt', (signer) =>
      signer.nip44Decrypt(peerPubkey, ciphertext),
    );
  }

  async destroy(): Promise<void> {
    const inner = this.inner;
    this.inner = null;
    this.connecting = null;
    this.connectionGeneration += 1;
    await inner?.close().catch(() => {});
  }
}
