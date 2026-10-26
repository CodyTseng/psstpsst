import { vaultAccess } from '@/platform/vault-access';
import { verifyEvent, type Event } from 'nostr-tools';
import { BUNKER_REGEX, parseBunkerInput } from 'nostr-tools/nip46';

import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { platform } from '@/platform';
import type { BunkerPairing, PairingResponse } from '@/platform/ports/key-vault';
import { addRemoteAccount } from '../account/account.service';
import { ManagedRelayPool } from '../relay/managed-relay-pool';
import { NIP46_PAIRING_TIMEOUT_MS, withNip46Timeout } from './nip46-timeout';

export const NIP46_DEFAULT_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];

/** Relay transport sees only public metadata and encrypted, native-signed messages. */
class PairingTransport {
  private pool = new ManagedRelayPool({ verifyEvent: event => verifyEvent(event) });
  private closed = false;
  private stop?: () => void;
  private pending?: { resolve(): void; reject(error: Error): void };
  private peerReady: Promise<void>;
  private resolvePeer?: () => void;
  private rejectPeer?: (error: Error) => void;
  private receiving: Promise<void> = Promise.resolve();

  constructor(readonly pairing: BunkerPairing, private relays: string[], peer: string | null) {
    this.peerReady = peer ? Promise.resolve() : new Promise((resolve, reject) => {
      this.resolvePeer = resolve; this.rejectPeer = reject;
    });
    void this.peerReady.catch(() => {});
    this.stop = this.pool.subscribe({ label: 'bunker-pairing', relays,
      filter: { kinds: [24133], ...(peer ? { authors: [peer] } : {}), '#p': [pairing.clientPubkey], limit: 0 },
      onEvent: event => {
        // Keep discovery and handshake replies in wire order across native round trips.
        this.receiving = this.receiving.then(() => this.receive(event)).catch(() => {});
      },
    });
  }

  private current(): void { if (this.closed) throw new Error('Pairing session ended'); }

  private async receive(event: Event): Promise<void> {
    this.current();
    const result = await vaultAccess.execute({ method: 'bunkerPairingReceive', session: this.pairing.session, event }) as PairingResponse;
    this.current();
    if (result.type === 'ignored') return;
    if (result.type === 'peer') { this.resolvePeer?.(); return; }
    if (result.type === 'auth') {
      try {
        const url = new URL(result.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') await platform.urlOpener.openExternalUrl(url.toString());
      } catch { /* Invalid authorization URLs disclose no result or credential. */ }
      return;
    }
    if (result.type === 'rejected') this.pending?.reject(new Error('Bunker rejected pairing'));
    else this.pending?.resolve();
  }

  private async exchange(operation: 'connect' | 'get_public_key'): Promise<void> {
    this.current();
    const event = await vaultAccess.execute({ method: 'bunkerPairingRequest', session: this.pairing.session, operation }) as Event;
    this.current();
    const response = new Promise<void>((resolve, reject) => { this.pending = { resolve, reject }; });
    void response.catch(() => {});
    const work = Promise.any(this.pool.underlyingPool.publish(this.relays, event, { maxWait: 60_000 })).then(() => response);
    try { await withNip46Timeout(work, operation, undefined, () => this.close()); }
    finally { this.pending = undefined; }
    this.current();
  }

  async connect(): Promise<{ pubkey: string }> {
    try {
      await this.peerReady; this.current();
      await this.exchange('connect');
      await this.exchange('get_public_key');
      this.current();
      const result = await addRemoteAccount(this.pairing.session);
      this.current();
      return result;
    } finally { this.close(); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop?.(); this.pool.destroy();
    const error = new Error('Pairing session ended');
    this.pending?.reject(error); this.rejectPeer?.(error);
    void vaultAccess.execute({ method: 'cancelBunkerPairing', session: this.pairing.session }).catch(() => {});
  }
}

export async function loginWithBunker(input: string): Promise<{ pubkey: string }> {
  const trimmed = input.trim();
  if (!BUNKER_REGEX.test(trimmed)) throw new Error('invalid');
  const pointer = await parseBunkerInput(trimmed);
  if (!pointer) throw new Error('invalid');
  const relays = Array.from(new Set(pointer.relays.map(normalizeRelayUrl)));
  const pairing = await vaultAccess.execute({ method: 'beginBunkerPairing', peer: pointer.pubkey,
    secret: pointer.secret ?? null, relays }) as BunkerPairing;
  const transport = new PairingTransport(pairing, relays, pointer.pubkey);
  return withNip46Timeout(transport.connect(), 'connection', NIP46_PAIRING_TIMEOUT_MS, () => transport.close());
}

export type NostrConnectSession = {
  uri: string;
  waitForConnection(): Promise<{ pubkey: string }>;
  cancel(): void;
};

/** Client key generation, nonce verification and credential persistence stay in the vault. */
export async function startNostrConnect(opts?: { relays?: string[] }): Promise<NostrConnectSession> {
  const relays = Array.from(new Set((opts?.relays?.length ? opts.relays : NIP46_DEFAULT_RELAYS).map(normalizeRelayUrl)));
  const pairing = await vaultAccess.execute({ method: 'beginBunkerPairing', peer: null, secret: null, relays }) as BunkerPairing;
  if (!pairing.uri) {
    await vaultAccess.execute({ method: 'cancelBunkerPairing', session: pairing.session });
    throw new Error('Invalid pairing invitation');
  }
  const transport = new PairingTransport(pairing, relays, null);
  const work = withNip46Timeout(transport.connect(), 'connection', NIP46_PAIRING_TIMEOUT_MS, () => transport.close());
  void work.catch(() => {});
  return { uri: pairing.uri, waitForConnection: () => work, cancel: () => transport.close() };
}
