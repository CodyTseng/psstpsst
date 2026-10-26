import { vaultFailure, vaultReply, unwrapVaultReply, VaultOperationError } from '../vault-failure';

test('reports a fixed operation and reason for a missing key', () => {
  expect(vaultFailure(new Error('Key not found'), 'publicKey'))
    .toBe('Key vault operation failed (publicKey: KEY_NOT_FOUND)');
});

test('classifies authentication failures using only fixed crypto context labels', () => {
  expect(vaultFailure(new Error('invalid MAC'), 'crypto', {
    algorithm: 'nip44', operation: 'decrypt', key: { role: 'messaging' },
  })).toBe('Key vault operation failed (crypto.nip44.decrypt.messaging: AUTHENTICATION_FAILED)');
  expect(vaultFailure(new Error('secret'), 'crypto', {
    algorithm: 'secret', operation: 'secret', key: { role: 'secret' },
  })).toBe('Key vault operation failed (crypto: OPERATION_FAILED)');
});

test('transports a handled failure as data and restores rejection at the caller', async () => {
  const message = 'Key vault operation failed (crypto.nip44.decrypt.messaging: AUTHENTICATION_FAILED)';
  const reply = await vaultReply(async () => { throw new VaultOperationError(message); });
  expect(reply).toEqual({ ok: false, error: message });
  expect(() => unwrapVaultReply(reply)).toThrow(message);
  const value = { ok: false, error: 'a legitimate command result' };
  expect(unwrapVaultReply(await vaultReply(async () => value))).toEqual(value);
});

test('does not suppress unexpected handler failures', async () => {
  await expect(vaultReply(async () => { throw new Error('Unexpected failure'); })).rejects.toThrow('Unexpected failure');
});

test('never reflects unknown exception messages or operation names', () => {
  const secret = 'nsec-sensitive-sentinel';
  expect(vaultFailure(new Error(secret), secret))
    .toBe('Key vault operation failed (internal: OPERATION_FAILED)');
});
