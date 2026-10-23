/** Format an exact integer millisatoshi amount without rounding its fractional sats. */
export function satsFromMsat(msat: number): string {
  if (!Number.isSafeInteger(msat) || msat < 0) throw new Error('invalid-amount');
  const digits = String(msat).padStart(4, '0');
  const fraction = digits.slice(-3).replace(/0+$/, '');
  return digits.slice(0, -3) + (fraction ? `.${fraction}` : '');
}
