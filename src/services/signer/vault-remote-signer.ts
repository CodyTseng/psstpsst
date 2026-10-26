import { vaultAccess } from '@/platform/vault-access';
import { type Event, type EventTemplate, verifyEvent } from 'nostr-tools';
import type { BunkerPointer } from 'nostr-tools/nip46';
import { platform } from '@/platform';
import { ManagedRelayPool } from '../relay/managed-relay-pool';
import { createVaultSigner } from './vault-signer';
import type { Signer } from './signer.interface';
import { withNip46Timeout } from './nip46-timeout';

/** Bunker transport uses the vault's client key without reading that credential. */
export function createVaultRemoteSigner(account: string, pointer: BunkerPointer): Signer {
  const pool = new ManagedRelayPool({ verifyEvent: event => verifyEvent(event) });
  const client = createVaultSigner({ account, role: 'nip46-client' });
  const pending = new Map<string, { resolve(value: string): void; reject(error: Error): void; authOpened: boolean }>();
  let closed = false;
  let generation = 0;
  let connection: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  const current = () => { if (closed) throw new Error('Signer has been destroyed'); };
  const disconnect = () => {
    generation++;
    unsubscribe?.(); unsubscribe = null;
    connection = null;
    for (const request of pending.values()) request.reject(new Error('Bunker connection ended'));
    pending.clear();
  };
  const receive = async (event: Event) => {
    try {
      current();
      if (event.pubkey !== pointer.pubkey || event.kind !== 24133 || !verifyEvent(event)) return;
      const response = JSON.parse(await client.nip44Decrypt!(pointer.pubkey, event.content));
      current();
      const waiter = pending.get(response.id);
      if (!waiter) return;
      if (response.result === 'auth_url') {
        if (!waiter.authOpened && typeof response.error === 'string') {
          waiter.authOpened = true;
          const url = new URL(response.error);
          if (url.protocol === 'https:' || url.protocol === 'http:') await platform.urlOpener.openExternalUrl(url.toString());
        }
        return;
      }
      pending.delete(response.id);
      if (response.error) waiter.reject(new Error('Bunker rejected the request'));
      else if (typeof response.result === 'string') waiter.resolve(response.result);
      else waiter.reject(new Error('Invalid bunker response'));
    } catch { /* Ignore malformed or late relay responses without logging their content. */ }
  };
  const send = async (method: string, params: string[]): Promise<string> => {
    current();
    const epoch = generation;
    const id = await platform.deviceCrypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- avoid initializing locale during account-module bootstrap
    const { default: i18n } = require('@/i18n/core') as typeof import('@/i18n/core');
    const confirmation = { language: i18n.language };
    const event = await vaultAccess.execute({ method: 'bunkerRequest', account, peer: pointer.pubkey, id, operation: method, params, confirmation }) as Event;
    current();
    if (epoch !== generation) throw new Error('Bunker connection ended');
    const result = new Promise<string>((resolve, reject) => { pending.set(id, { resolve, reject, authOpened: false }); });
    // Observe the response before publication to avoid losing a fast reply.
    const published = Promise.any(pool.underlyingPool.publish(pointer.relays, event, { maxWait: 60_000 }));
    const work = published.then(() => result);
    // A disconnect may reject result while publication is still in progress.
    void result.catch(() => {});
    try { return await withNip46Timeout(work, method, undefined, disconnect); }
    finally { pending.delete(id); }
  };
  const connect = (): Promise<void> => {
    current();
    if (!connection) {
      const epoch = generation;
      const task = (async () => {
        const pubkey = await client.getPublicKey();
        current();
        if (epoch !== generation) throw new Error('Bunker connection ended');
        unsubscribe = pool.subscribe({ label: 'bunker', relays: pointer.relays,
          filter: { kinds: [24133], authors: [pointer.pubkey], '#p': [pubkey], limit: 0 },
          onEvent: event => { void receive(event); },
        });
        await send('connect', []);
      })();
      connection = task;
      void task.catch(() => { if (connection === task) disconnect(); });
    }
    return connection;
  };
  const request = async (method: string, params: string[]) => {
    await connect(); current();
    const result = await send(method, params); current();
    return result;
  };
  return Object.freeze({
    getPublicKey: async () => {
      const pubkey = await request('get_public_key', []);
      if (pubkey !== account) throw new Error('Bunker account mismatch');
      return pubkey;
    },
    signEvent: async (template: EventTemplate) => {
      const event = JSON.parse(await request('sign_event', [JSON.stringify(template)])) as Event;
      if (!verifyEvent(event) || event.pubkey !== account || event.kind !== template.kind ||
        event.created_at !== template.created_at || event.content !== template.content ||
        JSON.stringify(event.tags) !== JSON.stringify(template.tags)) throw new Error('Invalid bunker signature');
      return event;
    },
    nip04Encrypt: (peer, text) => request('nip04_encrypt', [peer, text]),
    nip04Decrypt: (peer, text) => request('nip04_decrypt', [peer, text]),
    nip44Encrypt: (peer, text) => request('nip44_encrypt', [peer, text]),
    nip44Decrypt: (peer, text) => request('nip44_decrypt', [peer, text]),
    destroy: async () => {
      if (closed) return;
      closed = true; disconnect();
      await client.destroy?.(); pool.destroy();
    },
  } satisfies Signer);
}
