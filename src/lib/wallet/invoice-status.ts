import type { ParsedInvoice } from '@/services/wallet/bolt11';
import type { WalletTransactionRow } from '@/services/wallet/wallet.service';

export type InvoiceStatus = 'paid' | 'expired' | 'failed' | 'pending' | 'unknown';

export function invoiceStatus(
  invoice: ParsedInvoice,
  transaction: WalletTransactionRow | null | undefined,
  nowSeconds: number,
  options: { canVerifyPayment?: boolean } = {},
): InvoiceStatus {
  if (transaction) {
    if (isPaidTransaction(transaction)) return 'paid';
    if (isExpiredTransaction(transaction)) return 'expired';
    if (isFailedTransaction(transaction)) return 'failed';
  }
  if (invoice.expiresAt != null && invoice.expiresAt <= nowSeconds) return 'expired';
  if (options.canVerifyPayment === false) return 'unknown';
  return 'pending';
}

export function isPaidTransaction(transaction: WalletTransactionRow): boolean {
  return (
    transaction.state === 'settled' ||
    transaction.state === 'paid' ||
    transaction.state === 'success' ||
    transaction.settledAt != null ||
    transaction.preimage != null
  );
}

function isExpiredTransaction(transaction: WalletTransactionRow): boolean {
  return transaction.state === 'expired';
}

function isFailedTransaction(transaction: WalletTransactionRow): boolean {
  return (
    transaction.state === 'canceled' ||
    transaction.state === 'cancelled' ||
    transaction.state === 'failed' ||
    transaction.state === 'error'
  );
}
