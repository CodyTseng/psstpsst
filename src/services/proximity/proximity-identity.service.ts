import { vaultAccess } from '@/platform/vault-access';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { proximityAccounts } from '@/db/schema';
import { bytesToHex, hexToBytes } from '@/lib/nostr/keys';
import { verificationCodeFromPubkey } from '@/lib/nostr/verification-code';
import { platform } from '@/platform';
import type { Signer } from '@/services/signer/signer.interface';
import { createVaultSigner } from '@/services/signer/vault-signer';
import type { VaultKey } from '@/platform/ports/key-vault';
import { removeProximityEnabledPreference } from './proximity-preferences';

import {
  normalizeProximityDisplayName,
  normalizeOrRandomProximityDisplayName,
  randomProximityDisplayName,
} from './proximity-display-name';

export type ProximityIdentity = {
  accountPubkey: string;
  proximityPubkey: string;
  displayName: string;
  noisePubkey: Uint8Array;
  noiseBindingSignature: Uint8Array;
};

const pending = new Map<string, Promise<ProximityIdentity>>();
const identities = new Map<string, ProximityIdentity>();
const proximityPubkeys = new Map<string, string>();
/**
 * Keep the public half available to first-frame consumers without exposing the
 * private key through React state. Live database readers call this as they
 * resolve; `ensureProximityIdentity` also seeds it with the authoritative key.
 */
export function rememberProximityPubkey(
  accountPubkey: string,
  proximityPubkey: string,
): string {
  proximityPubkeys.set(accountPubkey, proximityPubkey);
  return proximityPubkey;
}

/** Synchronous session-cache lookup for bubble ownership and list previews. */
export function getCachedProximityPubkey(accountPubkey: string): string | undefined {
  return identities.get(accountPubkey)?.proximityPubkey ?? proximityPubkeys.get(accountPubkey);
}

async function loadOrCreate(accountPubkey: string): Promise<ProximityIdentity> {
  const [row] = await db
    .select()
    .from(proximityAccounts)
    .where(eq(proximityAccounts.accountPubkey, accountPubkey))
    .limit(1);
  const material = await vaultAccess.execute({ method: 'ensureProximity', account: accountPubkey }) as { pubkey: string; key: VaultKey };
  const proximityPubkey = material.pubkey;
  const now = Math.floor(Date.now() / 1000);
  const displayName = normalizeOrRandomProximityDisplayName(
    row && row.displayName === verificationCodeFromPubkey(row.proximityPubkey) ? '' : row?.displayName ?? '',
  );
  if (!row || row.proximityPubkey !== proximityPubkey || row.displayName !== displayName) {
    await db.insert(proximityAccounts)
      .values({ accountPubkey, proximityPubkey, displayName, createdAt: row?.createdAt ?? now, updatedAt: now })
      .onConflictDoUpdate({ target: proximityAccounts.accountPubkey, set: { proximityPubkey, displayName, updatedAt: now } });
  }
  const noisePubkey = await platform.noise.ensureIdentity(accountPubkey);
  const binding = await vaultAccess.execute({ method: 'bindProximityNoise', account: accountPubkey, noisePubkey: bytesToHex(noisePubkey) }) as string;
  return { accountPubkey, proximityPubkey, displayName, noisePubkey, noiseBindingSignature: hexToBytes(binding) };
}

export function ensureProximityIdentity(accountPubkey: string): Promise<ProximityIdentity> {
  const cached = identities.get(accountPubkey);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(accountPubkey);
  if (existing) return existing;
  const work = loadOrCreate(accountPubkey)
    .then((identity) => {
      identities.set(accountPubkey, identity);
      rememberProximityPubkey(accountPubkey, identity.proximityPubkey);
      return identity;
    })
    .finally(() => pending.delete(accountPubkey));
  pending.set(accountPubkey, work);
  return work;
}

/** Reusable event-signing boundary for protocols that explicitly use the local Proximity identity. */
export async function getProximityEventSigner(accountPubkey: string): Promise<Signer> {
  const identity = await ensureProximityIdentity(accountPubkey);
  return createVaultSigner({ account: accountPubkey, role: 'proximity', pubkey: identity.proximityPubkey });
}

export async function hasProximityIdentity(accountPubkey: string): Promise<boolean> {
  if (getCachedProximityPubkey(accountPubkey)) return true;
  const [row] = await db
    .select({ proximityPubkey: proximityAccounts.proximityPubkey })
    .from(proximityAccounts)
    .where(eq(proximityAccounts.accountPubkey, accountPubkey))
    .limit(1);
  if (row) rememberProximityPubkey(accountPubkey, row.proximityPubkey);
  return row != null;
}

export async function updateProximityDisplayName(
  accountPubkey: string,
  displayName: string,
): Promise<void> {
  const normalized = normalizeProximityDisplayName(displayName);
  let resolved = normalized;
  if (!resolved) {
    let identityExists = identities.has(accountPubkey);
    if (!identityExists) {
      const [row] = await db
        .select({ accountPubkey: proximityAccounts.accountPubkey })
        .from(proximityAccounts)
        .where(eq(proximityAccounts.accountPubkey, accountPubkey))
        .limit(1);
      identityExists = row != null;
    }
    if (!identityExists) throw new Error('Cannot name a proximity identity that does not exist');
    resolved = randomProximityDisplayName();
  }
  await db
    .update(proximityAccounts)
    .set({ displayName: resolved, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(proximityAccounts.accountPubkey, accountPubkey));
  const cached = identities.get(accountPubkey);
  if (cached) identities.set(accountPubkey, { ...cached, displayName: resolved });
}

export async function removeProximityIdentity(accountPubkey: string): Promise<void> {
  const inFlight = pending.get(accountPubkey);
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // Continue removing any partial persisted identity after a failed load.
    }
  }
  identities.delete(accountPubkey);
  proximityPubkeys.delete(accountPubkey);
  await vaultAccess.execute({ method: 'removeProximity', account: accountPubkey });
  await platform.noise.removeIdentity(accountPubkey);
  await db
    .delete(proximityAccounts)
    .where(eq(proximityAccounts.accountPubkey, accountPubkey));
  await removeProximityEnabledPreference(accountPubkey);
}
