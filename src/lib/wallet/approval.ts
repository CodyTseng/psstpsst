/** Only presentation data crosses the host's approval queue. */
export type WalletOption = { id: string; name: string; customName: string | null; isDefault: boolean };
export type WalletApprovalRequest = { operation: 'connect' } | {
  operation: 'payment' | 'invoice';
  wallets: WalletOption[];
  amountMsat: number;
  description: string;
  authentication?: 'system' | 'pin';
  amountRange?: { min: number; max: number };
};
export type WalletDecision = { walletId: string; pinAuthorization?: string; amountSats?: number };

export function walletDecision(answer: string | false): WalletDecision {
  if (!answer || answer.length > 4096) throw new Error('permission-denied');
  let value: unknown;
  try { value = JSON.parse(answer); } catch { throw new Error('permission-denied'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('permission-denied');
  const decision = value as Record<string, unknown>;
  if (Object.keys(decision).some(key => !['walletId', 'pinAuthorization', 'amountSats'].includes(key))
    || typeof decision.walletId !== 'string' || !decision.walletId || decision.walletId.length > 256
    || decision.pinAuthorization !== undefined && (typeof decision.pinAuthorization !== 'string' || !decision.pinAuthorization || decision.pinAuthorization.length > 256)
    || decision.amountSats !== undefined && (typeof decision.amountSats !== 'number' || !Number.isSafeInteger(decision.amountSats) || decision.amountSats <= 0)) throw new Error('permission-denied');
  return decision as WalletDecision;
}
