import { isVaultMethod } from '../src/platform/ports/key-vault';
const reasons = new Map([
  ['Vault storage unavailable', 'STORAGE_UNAVAILABLE'],
  ['Key not found', 'KEY_NOT_FOUND'],
  ['Messaging key not found', 'KEY_NOT_FOUND'],
  ['Key session ended', 'SESSION_ENDED'],
  ['Pairing session ended', 'SESSION_ENDED'],
  ['Account key mismatch', 'ACCOUNT_KEY_MISMATCH'],
  ['Invalid messaging key storage', 'INVALID_KEY_STORAGE'],
  ['Bunker binding mismatch', 'BUNKER_BINDING_MISMATCH'],
  ['Bunker binding requires confirmation', 'BUNKER_CONFIRMATION_REQUIRED'],
  ['Restricted signing key', 'RESTRICTED_OPERATION'],
  ['Restricted client operation', 'RESTRICTED_OPERATION'],
  ['Temporary keys require their dedicated operation', 'RESTRICTED_OPERATION'],
  ['Messaging keys require dedicated decryption', 'RESTRICTED_OPERATION'],
  ['invalid MAC', 'AUTHENTICATION_FAILED'],
  ['invalid padding', 'INVALID_CIPHERTEXT'],
  ['unknown encryption version', 'INVALID_CIPHERTEXT'],
  ['Invalid vault command', 'INVALID_REQUEST'],
]);

export class VaultOperationError extends Error {}

export type VaultReply = { ok: true; value: unknown } | { ok: false; error: string };

/** Handled vault failures must reach callers without Electron logging a rejected IPC invocation. */
export async function vaultReply(run: () => Promise<unknown>): Promise<VaultReply> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (!(error instanceof VaultOperationError)) throw error;
    return { ok: false, error: error.message };
  }
}

export function unwrapVaultReply(reply: VaultReply): unknown {
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

/** Only fixed labels may leave the worker; exception text and command values can contain secrets. */
export function vaultFailure(error: unknown, method: unknown, crypto?: { algorithm?: unknown; operation?: unknown; key?: { role?: unknown } }): string {
  let operation: string = isVaultMethod(method) ? method : 'internal';
  const role = crypto?.key?.role;
  if (method === 'crypto' && (crypto?.algorithm === 'nip04' || crypto?.algorithm === 'nip44') &&
    (crypto.operation === 'encrypt' || crypto.operation === 'decrypt') &&
    typeof role === 'string' && ['identity', 'messaging', 'nip46-client', 'ephemeral', 'proximity'].includes(role)) {
    operation += `.${crypto.algorithm}.${crypto.operation}.${role}`;
  }
  const reason = error instanceof Error ? reasons.get(error.message) : undefined;
  return `Key vault operation failed (${operation}: ${reason ?? 'OPERATION_FAILED'})`;
}
