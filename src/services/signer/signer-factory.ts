import type { BunkerPointer } from 'nostr-tools/nip46';

import { hexToBytes, privkeyToNsec } from '@/lib/nostr/keys';
import { platform } from '@/platform';

import { Nip46Signer } from './nip46-signer';
import { NsecSigner } from './nsec-signer';
import type { Signer } from './signer.interface';

const SECURE_KEY_IDENTITY_PRIVKEY = (accountPubkey: string) => `identity_privkey_${accountPubkey}`;
// The per-account local key used to talk to the bunker (NIP-46). Kept separate
// from (and isolated per) the account so two remote accounts never share a
// client identity the relay could correlate.
const SECURE_KEY_NIP46_CLIENT = (accountPubkey: string) => `nip46_client_privkey_${accountPubkey}`;
// The optional bunker connection secret is credential material too. Relay and
// bunker pubkeys remain in SQLite; only this secret is kept in the keychain.
const SECURE_KEY_NIP46_BUNKER_SECRET = (accountPubkey: string) =>
  `nip46_bunker_secret_${accountPubkey}`;

export type CreateSignerOpts = {
  accountPubkey: string;
  signerType: 'nsec' | 'nip46' | 'generated';
  signerPayload?: string | null;
};

export async function createSigner(opts: CreateSignerOpts): Promise<Signer> {
  if (opts.signerType === 'nsec' || opts.signerType === 'generated') {
    const hex = await platform.secureStorage.getItem(
      SECURE_KEY_IDENTITY_PRIVKEY(opts.accountPubkey),
    );
    if (!hex) throw new Error('Identity privkey not found in secure store');
    return new NsecSigner(hexToBytes(hex));
  }
  if (opts.signerType === 'nip46') {
    if (!opts.signerPayload) throw new Error('NIP-46 signer requires a stored connection');
    const clientHex = await platform.secureStorage.getItem(
      SECURE_KEY_NIP46_CLIENT(opts.accountPubkey),
    );
    if (!clientHex) throw new Error('NIP-46 client key not found in secure store');
    const storedPointer = JSON.parse(opts.signerPayload) as BunkerPointer;
    let bunkerSecret = await platform.secureStorage.getItem(
      SECURE_KEY_NIP46_BUNKER_SECRET(opts.accountPubkey),
    );
    // Defensive compatibility for a caller holding a pre-migration account row.
    // account.service normally extracts this before constructing the signer.
    if (bunkerSecret == null && storedPointer.secret != null) {
      bunkerSecret = storedPointer.secret;
      await storeNip46BunkerSecret(opts.accountPubkey, bunkerSecret);
    }
    const pointer: BunkerPointer = { ...storedPointer, secret: bunkerSecret };
    return new Nip46Signer(hexToBytes(clientHex), pointer);
  }
  throw new Error(`Unknown signer type: ${opts.signerType}`);
}

export async function storeNip46ClientKey(accountPubkey: string, clientKeyHex: string): Promise<void> {
  await platform.secureStorage.setItem(SECURE_KEY_NIP46_CLIENT(accountPubkey), clientKeyHex);
}

export async function removeNip46ClientKey(accountPubkey: string): Promise<void> {
  await platform.secureStorage.deleteItem(SECURE_KEY_NIP46_CLIENT(accountPubkey));
}

export async function storeNip46BunkerSecret(
  accountPubkey: string,
  secret: string | null,
): Promise<void> {
  if (secret == null) {
    await platform.secureStorage.deleteItem(SECURE_KEY_NIP46_BUNKER_SECRET(accountPubkey));
    return;
  }
  await platform.secureStorage.setItem(SECURE_KEY_NIP46_BUNKER_SECRET(accountPubkey), secret);
}

export async function removeNip46BunkerSecret(accountPubkey: string): Promise<void> {
  await platform.secureStorage.deleteItem(SECURE_KEY_NIP46_BUNKER_SECRET(accountPubkey));
}

export async function storeIdentityPrivkey(accountPubkey: string, privkeyHex: string): Promise<void> {
  await platform.secureStorage.setItem(SECURE_KEY_IDENTITY_PRIVKEY(accountPubkey), privkeyHex);
}

export async function removeIdentityPrivkey(accountPubkey: string): Promise<void> {
  await platform.secureStorage.deleteItem(SECURE_KEY_IDENTITY_PRIVKEY(accountPubkey));
}

/** Export the account's identity secret key as an `nsec…` string, for backup.
 * Returns null for remote (NIP-46) accounts that hold no local key. Treat the
 * result as a secret — it is the user's full Nostr identity. */
export async function exportIdentityNsec(accountPubkey: string): Promise<string | null> {
  const hex = await platform.secureStorage.getItem(SECURE_KEY_IDENTITY_PRIVKEY(accountPubkey));
  if (!hex) return null;
  return privkeyToNsec(hexToBytes(hex));
}
