import { vaultAccess } from '@/platform/vault-access';
import type { BunkerPointer } from 'nostr-tools/nip46';


import { createVaultSigner } from './vault-signer';
import { createVaultRemoteSigner } from './vault-remote-signer';
import type { Signer } from './signer.interface';
import { acquireAccountSigner, endAccountSignerSession } from './signer-sessions';

export type CreateSignerOpts = {
  accountPubkey: string;
  signerType: 'nsec' | 'nip46' | 'generated';
  signerPayload?: string | null;
};

export async function createSigner(opts: CreateSignerOpts): Promise<Signer> {
  return acquireAccountSigner(opts.accountPubkey, () => createSignerImplementation(opts));
}

async function createSignerImplementation(opts: CreateSignerOpts): Promise<Signer> {
  if (opts.signerType === 'nsec' || opts.signerType === 'generated') {
    return createVaultSigner({ account: opts.accountPubkey, role: 'identity' });
  }
  if (opts.signerType === 'nip46' && opts.signerPayload) {
    const pointer = JSON.parse(opts.signerPayload) as BunkerPointer;
    if (pointer.secret != null) await migrateNip46BunkerSecret(opts.accountPubkey, pointer.secret, pointer.pubkey);
    return createVaultRemoteSigner(opts.accountPubkey, { ...pointer, secret: null });
  }
  throw new Error('Unsupported signer configuration');
}

export async function migrateNip46BunkerSecret(accountPubkey: string, secret: string | null, peer: string): Promise<void> {
  await vaultAccess.execute({ method: 'migrateBunkerSecret', account: accountPubkey, secret, peer });
}
export async function removeNip46Credentials(accountPubkey: string): Promise<void> {
  await endAccountSignerSession(accountPubkey);
  await vaultAccess.execute({ method: 'removeBunker', account: accountPubkey });
}
export async function removeIdentityPrivkey(accountPubkey: string): Promise<void> {
  await endAccountSignerSession(accountPubkey);
  await vaultAccess.execute({ method: 'removeIdentity', account: accountPubkey });
}
