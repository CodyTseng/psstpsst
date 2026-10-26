import { vaultAccess } from '@/platform/vault-access';
import type { VaultKey } from '@/platform/ports/key-vault';
import type { Event } from 'nostr-tools';
import type { Signer } from './signer.interface';

/** The facade contains only a public key reference, never secret key bytes. */
export function createVaultSigner(key: VaultKey): Signer {
  let closed = false;
  const call = async <T>(run: () => Promise<unknown>): Promise<T> => {
    if (closed) throw new Error('Signer has been destroyed');
    const result = await run();
    if (closed) throw new Error('Signer has been destroyed');
    return result as T;
  };
  const crypto = (algorithm: 'nip04' | 'nip44', operation: 'encrypt' | 'decrypt', peer: string, text: string) =>
    call<string>(() => vaultAccess.execute({ method: 'crypto', key, algorithm, operation, peer, text }));
  return Object.freeze({
    getPublicKey: () => call<string>(() => vaultAccess.execute({ method: 'publicKey', key })),
    signEvent: template => call<Event>(() => vaultAccess.execute({ method: 'signEvent', key, template })),
    nip04Encrypt: (peer, text) => crypto('nip04', 'encrypt', peer, text),
    nip04Decrypt: (peer, text) => crypto('nip04', 'decrypt', peer, text),
    nip44Encrypt: (peer, text) => crypto('nip44', 'encrypt', peer, text),
    nip44Decrypt: (peer, text) => crypto('nip44', 'decrypt', peer, text),
    destroy: () => { closed = true; },
  } satisfies Signer);
}
