/** Format a uniformly random public key as a short human-comparable code. */
export function verificationCodeFromPubkey(pubkey: string): string {
  const code = pubkey.slice(0, 8).toUpperCase();
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
