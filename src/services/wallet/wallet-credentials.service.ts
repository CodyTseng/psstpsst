import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { wallets } from '@/db/schema';
import { vaultAccess } from '@/platform/vault-access';

/** Delete every NWC credential owned by an account before its wallet rows are
 * cascaded away. The rows are needed to enumerate the per-wallet key names. */
export async function removeAccountWalletSecrets(accountPubkey: string): Promise<void> {
  const rows = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.accountPubkey, accountPubkey));
  for (const wallet of rows) {
    await vaultAccess.execute({ method: 'walletRemove', account: accountPubkey, walletId: wallet.id });
  }
  await vaultAccess.execute({ method: 'walletRemovePin', account: accountPubkey });
}
