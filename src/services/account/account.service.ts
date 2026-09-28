import { asc, eq } from 'drizzle-orm';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { BunkerPointer } from 'nostr-tools/nip46';

import { db } from '@/db/client';
import {
  accounts,
  blockedUsers,
  contacts,
  conversations,
  mediaServerLists,
  messageDrafts,
  messageDeliveryCopies,
  messageMedia,
  messages,
  outbox,
  configurationOutbox,
  pendingAttachments,
  processedGiftWraps,
  processedSyncRequests,
  proximityPeers,
  relayOutboxJobs,
  relayLists,
  syncCursors,
} from '@/db/schema';
import { bytesToHex, hexToBytes, nsecToPrivkey, privkeyToNsec } from '@/lib/nostr/keys';

import { deleteAllAccountArchives } from '../dm/dm-backup-storage';
import { clearAccountKeyMaterial } from '../dm/encryption-key.service';
import { removeKeyRotationInterval } from '../dm/encryption-key-rotation-prefs';
import { deleteAccountAttachments } from '../files/file-attachment.service';
import { deletePendingAttachmentFile } from '../files/pending-attachment-file.service';
import { deleteAccountNearbyFileData } from '../files/nearby-file-upload.service';
import {
  createSigner,
  removeIdentityPrivkey,
  removeNip46BunkerSecret,
  removeNip46ClientKey,
  storeNip46BunkerSecret,
  storeIdentityPrivkey,
  storeNip46ClientKey,
} from '../signer/signer-factory';
import {
  deleteDevicePreference,
  getDevicePreference,
  legacyWalletBalanceVisiblePreferenceKey,
  setDevicePreference,
  walletBalanceVisiblePreferenceKey,
} from '../preferences/device-preferences.service';
import { removeAccountWalletSecrets } from '../wallet/wallet-credentials.service';
import type { Signer } from '../signer/signer.interface';
import { removeProximityIdentity } from '../proximity/proximity-identity.service';

const ACTIVE_ACCOUNT_KEY = 'active_account_pubkey';

export async function listAccounts() {
  // Manual order (ascending) — stable across switches, so the list never
  // reshuffles under the user's thumb. See {@link reorderAccounts}.
  const rows = await db.select().from(accounts).orderBy(asc(accounts.sortOrder));
  return Promise.all(rows.map(protectNip46BunkerSecret));
}

/**
 * Persist a new account order (the pubkeys in the desired top-to-bottom order),
 * assigning `sort_order` 0, 1, 2, …. Used by the account manager's drag-reorder.
 */
export async function reorderAccounts(pubkeysInOrder: string[]): Promise<void> {
  for (let i = 0; i < pubkeysInOrder.length; i++) {
    await db.update(accounts).set({ sortOrder: i }).where(eq(accounts.pubkey, pubkeysInOrder[i]));
  }
}

export async function getActiveAccountPubkey(): Promise<string | null> {
  return getDevicePreference(ACTIVE_ACCOUNT_KEY, ACTIVE_ACCOUNT_KEY);
}

export async function setActiveAccountPubkey(pubkey: string): Promise<void> {
  await setDevicePreference(ACTIVE_ACCOUNT_KEY, pubkey);
  await db
    .update(accounts)
    .set({ lastActiveAt: Math.floor(Date.now() / 1000) })
    .where(eq(accounts.pubkey, pubkey));
}

export async function clearActiveAccountPubkey(): Promise<void> {
  await deleteDevicePreference(ACTIVE_ACCOUNT_KEY, ACTIVE_ACCOUNT_KEY);
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

  await storeNip46BunkerSecret(account.pubkey, pointer.secret);
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

export async function addAccountFromNsec(nsec: string): Promise<{ pubkey: string }> {
  const privkey = nsecToPrivkey(nsec);
  const pubkey = getPublicKey(privkey);
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(accounts)
    .values({ pubkey, signerType: 'nsec', addedAt: now, sortOrder: now })
    .onConflictDoNothing();
  await storeIdentityPrivkey(pubkey, bytesToHex(privkey));
  return { pubkey };
}

/**
 * Generate a fresh keypair in memory only. Nothing is persisted until the user
 * confirms the key backup — see {@link persistGeneratedAccount}.
 */
export function generateAccountKeyMaterial(): {
  pubkey: string;
  privkeyHex: string;
  nsec: string;
} {
  const privkey = generateSecretKey();
  return {
    pubkey: getPublicKey(privkey),
    privkeyHex: bytesToHex(privkey),
    nsec: privkeyToNsec(privkey),
  };
}

/** Persist a freshly generated account once the user confirmed the key backup. */
export async function persistGeneratedAccount(privkeyHex: string): Promise<{ pubkey: string }> {
  const pubkey = getPublicKey(hexToBytes(privkeyHex));
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(accounts)
    .values({ pubkey, signerType: 'generated', localSetupPending: true, addedAt: now, sortOrder: now })
    .onConflictDoNothing();
  await storeIdentityPrivkey(pubkey, privkeyHex);
  return { pubkey };
}

/** Clear only after the first key and configuration publications are durable. */
export async function completeGeneratedAccountSetup(pubkey: string): Promise<void> {
  await db.update(accounts).set({ localSetupPending: false }).where(eq(accounts.pubkey, pubkey));
}

/**
 * Register a NIP-46 remote-signer account after a connection has been
 * established. `pubkey` is the **signing** pubkey reported by the bunker (which
 * may differ from the bunker's own pubkey), `pointer` is the resolved bunker
 * connection. Its non-secret relay/pubkey metadata is serialized in SQLite;
 * its optional secret and `clientSecretKeyHex` are stored in the keychain.
 */
export async function addRemoteAccount(opts: {
  pubkey: string;
  pointer: BunkerPointer;
  clientSecretKeyHex: string;
}): Promise<{ pubkey: string }> {
  const now = Math.floor(Date.now() / 1000);
  const signerPayload = JSON.stringify({ ...opts.pointer, secret: null } satisfies BunkerPointer);
  await db
    .insert(accounts)
    .values({
      pubkey: opts.pubkey,
      signerType: 'nip46',
      signerPayload,
      addedAt: now,
      sortOrder: now,
    })
    .onConflictDoNothing();
  await storeNip46ClientKey(opts.pubkey, opts.clientSecretKeyHex);
  await storeNip46BunkerSecret(opts.pubkey, opts.pointer.secret);
  return { pubkey: opts.pubkey };
}

export async function setAccountEncryptionPubkey(
  accountPubkey: string,
  encryptionPubkey: string,
): Promise<void> {
  await db
    .update(accounts)
    .set({ encryptionPubkey })
    .where(eq(accounts.pubkey, accountPubkey));
}

/**
 * Wipe every per-account-scoped row this account owns — messages and their
 * attachments/participants, conversations, drafts, contacts, blocks, relay and
 * media-server lists, sync cursors, and dedup logs. All data is keyed by
 * `account_pubkey` (see migration 0017), so a removed account leaves nothing
 * behind for a later re-add to surface. Global profile rows remain shared.
 */
async function deleteAccountData(pubkey: string): Promise<void> {
  const pendingFiles = await db
    .select({ localName: pendingAttachments.localName })
    .from(pendingAttachments)
    .where(eq(pendingAttachments.accountPubkey, pubkey));
  await Promise.all(pendingFiles.map((row) => deletePendingAttachmentFile(row.localName)));
  const scoped = [
    messages,
    messageDeliveryCopies,
    messageMedia,
    conversations,
    messageDrafts,
    contacts,
    blockedUsers,
    relayLists,
    mediaServerLists,
    syncCursors,
    processedGiftWraps,
    processedSyncRequests,
    proximityPeers,
    outbox,
    relayOutboxJobs,
    configurationOutbox,
    pendingAttachments,
  ];
  for (const table of scoped) {
    await db.delete(table).where(eq(table.accountPubkey, pubkey));
  }
}

export async function removeAccount(pubkey: string): Promise<void> {
  // Wallet rows are about to cascade with the account, so enumerate and remove
  // their per-wallet SecureStore credentials while the ids still exist.
  await removeAccountWalletSecrets(pubkey);
  // Free the account's on-disk attachment blobs first — the reference count
  // reads the `message_media` rows that `deleteAccountData` then drops.
  // (Blobs a remaining account still references are kept.)
  await deleteAccountAttachments(pubkey);
  await deleteAccountNearbyFileData(pubkey);
  await deleteAllAccountArchives(pubkey);
  await deleteAccountData(pubkey);
  await db.delete(accounts).where(eq(accounts.pubkey, pubkey));
  await removeIdentityPrivkey(pubkey);
  await removeNip46ClientKey(pubkey);
  await removeNip46BunkerSecret(pubkey);
  await clearAccountKeyMaterial(pubkey);
  await removeProximityIdentity(pubkey);
  await removeKeyRotationInterval(pubkey);
  await deleteDevicePreference(
    walletBalanceVisiblePreferenceKey(pubkey),
    legacyWalletBalanceVisiblePreferenceKey(pubkey),
  );
  const active = await getActiveAccountPubkey();
  if (active === pubkey) {
    await deleteDevicePreference(ACTIVE_ACCOUNT_KEY, ACTIVE_ACCOUNT_KEY);
  }
}
