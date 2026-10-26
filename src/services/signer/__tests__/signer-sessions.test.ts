import { vaultAccess } from '@/platform/vault-access';
import { acquireAccountSigner, endAccountSignerSession } from '../signer-sessions';
import type { Signer } from '../signer.interface';
jest.mock('@/platform/vault-access', () => ({ vaultAccess: jest.requireMock('@/platform').platform.keyVault }));

jest.mock('@/platform', () => ({ platform: { keyVault: { execute: jest.fn(async () => null) } } }));
const template = { kind: 1, content: '', created_at: 1, tags: [] };
function implementation() {
  return { getPublicKey: jest.fn(async () => 'account'), signEvent: jest.fn(), destroy: jest.fn(async () => {}) } satisfies Signer;
}
afterEach(async () => { await endAccountSignerSession('account'); jest.clearAllMocks(); });

test('consumer teardown preserves the account implementation and other leases', async () => {
  const owner = implementation(); const create = jest.fn(async () => owner);
  const first = acquireAccountSigner('account', create);
  const second = acquireAccountSigner('account', create);
  await first.getPublicKey(); await first.destroy?.();
  await expect(first.getPublicKey()).rejects.toThrow('ended');
  await expect(second.getPublicKey()).resolves.toBe('account');
  expect(create).toHaveBeenCalledTimes(1); expect(owner.destroy).not.toHaveBeenCalled();
});

test('account revocation suppresses pending results and permits a fresh owner', async () => {
  let finish!: (value: string) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const owner = implementation(); owner.getPublicKey.mockImplementation(() => new Promise(resolve => { finish = resolve; started(); }));
  const lease = acquireAccountSigner('account', async () => owner);
  const pending = lease.getPublicKey();
  const rejected = expect(pending).rejects.toThrow('ended');
  await entered;
  await endAccountSignerSession('account'); finish('account');
  await rejected;
  expect(owner.destroy).toHaveBeenCalledTimes(1);
  expect(vaultAccess.execute).toHaveBeenCalledWith({ method: 'endSession', account: 'account' });
  const fresh = implementation();
  await expect(acquireAccountSigner('account', async () => fresh).getPublicKey()).resolves.toBe('account');
});

test('revocation during creation destroys the implementation once it arrives', async () => {
  let finish!: (value: Signer) => void;
  const owner = implementation();
  const lease = acquireAccountSigner('account', () => new Promise(resolve => { finish = resolve; }));
  const pending = lease.signEvent(template); void pending.catch(() => {});
  await Promise.resolve();
  const ended = endAccountSignerSession('account');
  finish(owner); await ended;
  await expect(pending).rejects.toThrow('ended');
  expect(owner.signEvent).not.toHaveBeenCalled(); expect(owner.destroy).toHaveBeenCalledTimes(1);
});
