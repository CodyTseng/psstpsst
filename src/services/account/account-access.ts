import { asc, eq } from 'drizzle-orm';
import type { BunkerPointer } from 'nostr-tools/nip46';

import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { createSigner, migrateNip46BunkerSecret } from '@/services/signer/signer-factory';
import type { Signer } from '@/services/signer/signer.interface';

/** Account reads and signer construction must not import account lifecycle services. */
export async function listAccounts() {
  // Manual order (ascending) — stable across switches, so the list never
  // reshuffles under the user's thumb. See {@link reorderAccounts}.
  const rows = await db.select().from(accounts).orderBy(asc(accounts.sortOrder));
  return Promise.all(rows.map(protectNip46BunkerSecret));
}

export async function getAccount(pubkey: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.pubkey, pubkey)).limit(1);
  return rows[0] ? protectNip46BunkerSecret(rows[0]) : null;
}

/** Upgrade every legacy remote-account row at startup, including inactive
 * accounts the user may not switch to during this session. */
export async function migrateNip46BunkerSecrets(): Promise<void> {
  const rows = await db.select().from(accounts).where(eq(accounts.signerType, 'nip46'));
  for (const account of rows) await protectNip46BunkerSecret(account);
}

/** Move a legacy BunkerPointer secret out of signer_payload before returning the
 * account row. New rows are already sanitized; this path upgrades existing
 * installs lazily without ever leaving the only copy of the secret in flight. */
async function protectNip46BunkerSecret(account: typeof accounts.$inferSelect) {
  if (account.signerType !== 'nip46' || !account.signerPayload) return account;
  let pointer: BunkerPointer;
  try {
    pointer = JSON.parse(account.signerPayload) as BunkerPointer;
  } catch {
    return account;
  }
  if (pointer.secret == null) return account;

  await migrateNip46BunkerSecret(account.pubkey, pointer.secret, pointer.pubkey);
  const signerPayload = JSON.stringify({ ...pointer, secret: null } satisfies BunkerPointer);
  await db.update(accounts).set({ signerPayload }).where(eq(accounts.pubkey, account.pubkey));
  return { ...account, signerPayload };
}

/**
 * Resolve the active signer for an account in one call — looks up the stored
 * account row and constructs the matching signer. Throws if the account is
 * unknown. Use this instead of repeating getAccount + createSigner.
 */
export async function buildSigner(accountPubkey: string): Promise<Signer> {
  const account = await getAccount(accountPubkey);
  if (!account) throw new Error('Account not found');
  return createSigner({
    accountPubkey,
    signerType: account.signerType,
    signerPayload: account.signerPayload,
  });
}

