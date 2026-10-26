import { db } from '@/db/client';
import { accounts, wallets } from '@/db/schema';
import { platform } from '@/platform';
import { vaultAccess } from '@/platform/vault-access';
import { migrateNip46BunkerSecrets } from '@/services/account/account-access';
import {
  getDevicePreference,
  setDevicePreference,
  legacyWalletBalanceVisiblePreferenceKey,
  walletBalanceVisiblePreferenceKey,
} from '@/services/preferences/device-preferences.service';

const MIGRATION_KEY = 'storage.vaultMigration.v1';
const PREFERENCES = ['language.preference', 'theme.preference', 'theme.accent', 'chat.enterToSend',
  'chat.quickReactions', 'active_account_pubkey', 'notifications.enabled'];
let pending: Promise<void> | undefined;

/** Finish the local storage upgrade before any account or network work starts. */
export function migrateLegacyStorage(): Promise<void> {
  return pending ??= migrate().catch(error => { pending = undefined; throw error; });
}

async function migrate(): Promise<void> {
  if (await getDevicePreference(MIGRATION_KEY) === 'complete') return;
  await migrateNip46BunkerSecrets();
  const accountRows = await db.select({ pubkey: accounts.pubkey, signerType: accounts.signerType,
    signerPayload: accounts.signerPayload }).from(accounts);
  const walletRows = await db.select({ account: wallets.accountPubkey, walletId: wallets.id,
    peer: wallets.walletPubkey, relaysJson: wallets.relaysJson }).from(wallets);
  // Only public routing metadata crosses this boundary. All key formats and
  // legacy secure-storage records are upgraded inside the native/worker vault.
  const bunkers = accountRows.filter(row => row.signerType === 'nip46' && row.signerPayload).map(row => ({
    account: row.pubkey, peer: (JSON.parse(row.signerPayload!) as { pubkey: string }).pubkey,
  }));
  await vaultAccess.execute({ method: 'migrateStorage', accounts: accountRows.map(row => row.pubkey), bunkers,
    wallets: walletRows.map(({ relaysJson, ...wallet }) => ({ ...wallet, relays: JSON.parse(relaysJson) as string[] })) });
  for (const key of PREFERENCES) await migratePreference(key, key);
  for (const { pubkey } of accountRows) {
    await migratePreference(walletBalanceVisiblePreferenceKey(pubkey), legacyWalletBalanceVisiblePreferenceKey(pubkey));
  }
  // Write last: a failed or interrupted run resumes its idempotent steps.
  await setDevicePreference(MIGRATION_KEY, 'complete');
}

async function migratePreference(key: string, legacyKey: string): Promise<void> {
  await getDevicePreference(key, legacyKey);
  // Also finish cleanup after a crash between the SQLite write and key deletion.
  await platform.security.deleteLegacyPreference(legacyKey);
}
