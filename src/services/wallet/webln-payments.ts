import { db } from '@/db/client';
import { webLnPayments } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';

/** Claim once before publishing. An uncertain result never authorizes another debit. */
export async function claimWebLnPayment(accountPubkey: string, paymentHash: string): Promise<void> {
  await db.transaction(async tx => {
    if (!await canReceiveForAccount(accountPubkey, tx)) throw new Error('account-unavailable');
    const rows = await tx.insert(webLnPayments).values({ accountPubkey, paymentHash, createdAt: Date.now() })
      .onConflictDoNothing().returning();
    if (!rows.length) throw new Error('payment-already-attempted');
  });
}
