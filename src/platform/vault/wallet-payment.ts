/** Derive the reviewed amount from the exact BOLT-11 invoice sent to the wallet. */
export function walletPaymentAmount(invoice: string): string {
  const match = invoice.match(/^ln(?:bcrt|bc|tb)([0-9]+)([munp]?)1[023456789acdefghjklmnpqrstuvwxyz]+$/);
  if (!match || match[1].length > 18) throw new Error('Invalid payment invoice');
  const digits = BigInt(match[1]);
  const multiplier = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n, p: 1n }[match[2]]!;
  if (match[2] === 'p' && digits % 10n !== 0n) throw new Error('Invalid payment amount');
  const msat = match[2] === 'p' ? digits / 10n : digits * multiplier;
  if (msat <= 0n || msat > 2_100_000_000_000_000_000n) throw new Error('Invalid payment amount');
  const fraction = (msat % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return (msat / 1000n).toString() + (fraction ? `.${fraction}` : '');
}
