import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { wallets } from '@/db/schema';
import { platform } from '@/platform';
import { removeWalletPin } from './wallet-pin.service';

export function nwcSecretKey(accountPubkey: string, walletId: string): string {
  return `psstpsst.nwc.${accountPubkey.slice(0, 16)}.${walletId}`;
}

/** Delete every NWC credential owned by an account before its wallet rows are
 * cascaded away. The rows are needed to enumerate the per-wallet key names. */
export async function removeAccountWalletSecrets(accountPubkey: string): Promise<void> {
  const rows = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.accountPubkey, accountPubkey));
  for (const wallet of rows) {
    await platform.secureStorage.deleteItem(nwcSecretKey(accountPubkey, wallet.id));
  }
  await removeWalletPin(accountPubkey);
}
