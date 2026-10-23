import { payInvoice, type WalletRow } from '../wallet.service';
import { platform } from '@/platform';
import { relayPool } from '@/services/relay/relay-pool';
import { getPublicKey } from 'nostr-tools';
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { subscribe: jest.fn(), publishEvent: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: {
  localAuth: { hasEnrolledAuth: jest.fn(async () => true), authenticate: jest.fn(async () => true) },
  secureStorage: { getItem: jest.fn(async () => '01'.repeat(32)) },
} }));
const wallet = { id: 'wallet-guard', accountPubkey: 'account', walletPubkey: getPublicKey(new Uint8Array(32).fill(2)),
  relaysJson: '["wss://relay.example"]' } as WalletRow;
beforeEach(() => { jest.clearAllMocks(); });
it('checks authority after system authentication, before touching the wallet secret', async () => {
  let valid = true;
  jest.mocked(platform.localAuth.authenticate).mockImplementationOnce(async () => { valid = false; return true; });
  await expect(payInvoice(wallet, 'invoice', { prompt: '', cancel: '' }, undefined, undefined, {
    check: () => { if (!valid) throw new Error('revoked'); },
  })).rejects.toThrow('revoked');
  expect(platform.secureStorage.getItem).not.toHaveBeenCalled();
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
it('checks authority after asynchronous preparation, immediately before publication', async () => {
  let valid = true;
  const beforeSend = jest.fn(async () => { valid = false; });
  await expect(payInvoice({ ...wallet, id: 'guard-final' }, 'invoice', { prompt: '', cancel: '' }, undefined, undefined, {
    check: () => { if (!valid) throw new Error('revoked'); }, beforeSend,
  })).rejects.toThrow('revoked');
  expect(beforeSend).toHaveBeenCalledTimes(1);
  expect(relayPool.subscribe).not.toHaveBeenCalled();
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
it('fails closed when durable preparation fails', async () => {
  await expect(payInvoice({ ...wallet, id: 'guard-storage' }, 'invoice', { prompt: '', cancel: '' }, undefined, undefined, {
    check: () => {}, beforeSend: async () => { throw new Error('storage-failed'); },
  })).rejects.toThrow('storage-failed');
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
