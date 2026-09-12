import { and, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';

import { db } from '@/db/client';
import { walletTransactions } from '@/db/schema';

function selectInvoiceTransaction(accountPubkey: string, invoice: string) {
  return db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.accountPubkey, accountPubkey),
        eq(walletTransactions.invoice, invoice),
      ),
    )
    .orderBy(desc(walletTransactions.updatedAt))
    .limit(1);
}

export function useInvoiceTransaction(
  accountPubkey: string | null | undefined,
  invoice: string | null | undefined,
) {
  const safePubkey = accountPubkey ?? '';
  const safeInvoice = invoice ?? '';
  const { data, updatedAt } = useLiveQuery(selectInvoiceTransaction(safePubkey, safeInvoice), [
    safePubkey,
    safeInvoice,
  ]);
  const loaded = updatedAt !== undefined;
  return {
    transaction: accountPubkey && invoice ? (data?.[0] ?? null) : null,
    loaded,
  };
}
