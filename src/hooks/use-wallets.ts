import { useLiveQuery } from '@/db/use-live-query';
import { and, asc, desc, eq, gt, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { useEffect, useState } from 'react';

import { db } from '@/db/client';
import { wallets, walletTransactions } from '@/db/schema';
import { isPaidTransaction } from '@/lib/wallet/invoice-status';

const HIDDEN_TRANSACTION_STATES = ['accepted', 'canceled', 'cancelled', 'failed', 'error'];
const MAX_EXPIRY_DELAY_MS = 2_147_483_647;

export function useWallets(accountPubkey: string | null | undefined, liveDataEnabled = true) {
  const safePubkey = accountPubkey ?? '';
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(wallets)
      .where(eq(wallets.accountPubkey, safePubkey))
      .orderBy(asc(wallets.sortOrder)),
    [safePubkey, liveDataEnabled],
    { enabled: liveDataEnabled },
  );
  return { wallets: accountPubkey ? (data ?? []) : [], loaded: updatedAt !== undefined };
}

export function useDefaultWallet(accountPubkey: string | null | undefined) {
  const safePubkey = accountPubkey ?? '';
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(wallets)
      .where(and(eq(wallets.accountPubkey, safePubkey), eq(wallets.isDefault, true)))
      .limit(1),
    [safePubkey],
  );
  return { wallet: accountPubkey ? (data?.[0] ?? null) : null, loaded: updatedAt !== undefined };
}

export function useWalletTransactions(walletId: string | null | undefined) {
  const safeWalletId = walletId ?? '';
  const [expiryRevision, setExpiryRevision] = useState(0);
  const successful = or(
    eq(walletTransactions.state, 'settled'),
    eq(walletTransactions.state, 'paid'),
    eq(walletTransactions.state, 'success'),
    isNotNull(walletTransactions.settledAt),
    isNotNull(walletTransactions.preimage),
  );
  const notExpired = and(
    ne(walletTransactions.state, 'expired'),
    or(isNull(walletTransactions.expiresAt), gt(walletTransactions.expiresAt, sql`CAST(strftime('%s', 'now') AS INTEGER)`)),
  );
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, safeWalletId),
          notInArray(walletTransactions.state, HIDDEN_TRANSACTION_STATES),
          or(successful, notExpired),
        ),
      )
      .orderBy(desc(walletTransactions.createdAt))
      .limit(30),
    [safeWalletId, expiryRevision],
  );

  useEffect(() => {
    let nextExpiry = Infinity;
    for (const transaction of data ?? []) {
      if (transaction.walletId !== safeWalletId || isPaidTransaction(transaction)) continue;
      if (transaction.expiresAt != null) nextExpiry = Math.min(nextExpiry, transaction.expiresAt);
    }
    if (!Number.isFinite(nextExpiry)) return;

    // Re-query only when a visible record expires, keeping work bounded to
    // the recent transaction window instead of polling the entire history.
    const delay = Math.min(MAX_EXPIRY_DELAY_MS, Math.max(0, nextExpiry * 1000 - Date.now()));
    const timer = setTimeout(() => setExpiryRevision((revision) => revision + 1), delay);
    return () => clearTimeout(timer);
  }, [data, safeWalletId]);

  return { transactions: walletId ? (data ?? []) : [], loaded: updatedAt !== undefined };
}

export function useWalletTransaction(id: string) {
  const { data, updatedAt } = useLiveQuery(
    db.select().from(walletTransactions).where(eq(walletTransactions.id, id)).limit(1),
    [id],
  );
  return { transaction: data?.[0] ?? null, loaded: updatedAt !== undefined };
}
