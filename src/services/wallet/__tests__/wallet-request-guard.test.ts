import { lookupInvoiceStatus, payInvoice, type WalletRow } from '../wallet.service';
import { vaultAccess } from '@/platform/vault-access';
import { relayPool } from '@/services/relay/relay-pool';
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { language: 'en' } }));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { subscribe: jest.fn(), publishEvent: jest.fn() } }));
jest.mock('@/platform/vault-access', () => ({ vaultAccess: { execute: jest.fn() } }));
const wallet = { id: 'wallet-guard', accountPubkey: 'account', walletPubkey: 'a'.repeat(64), relaysJson: '["wss://relay.example/"]' } as WalletRow;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(vaultAccess.execute).mockImplementation(async command => command.method === 'walletRequest' ? { event: { id: 'request' }, peer: wallet.walletPubkey, relays: ['wss://relay.example/'] } : null);
});
it('checks authority after trusted payment authentication and before publication', async () => {
  let valid = true;
  jest.mocked(vaultAccess.execute).mockImplementation(async command => {
    if (command.method === 'walletRequest') { valid = false; return { event: { id: 'request' }, peer: wallet.walletPubkey, relays: [] }; }
    return null;
  });
  await expect(payInvoice(wallet, 'invoice', { prompt: '', cancel: '' }, undefined, { check: () => { if (!valid) throw new Error('revoked'); } })).rejects.toThrow('revoked');
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
it('checks authority after durable preparation, immediately before publication', async () => {
  let valid = true;
  const beforeSend = jest.fn(async () => { valid = false; });
  await expect(payInvoice({ ...wallet, id: 'guard-final' }, 'invoice', { prompt: '', cancel: '' }, undefined, {
    check: () => { if (!valid) throw new Error('revoked'); }, beforeSend,
  })).rejects.toThrow('revoked');
  expect(beforeSend).toHaveBeenCalledTimes(1); expect(relayPool.subscribe).not.toHaveBeenCalled(); expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
it('fails closed when durable preparation fails', async () => {
  await expect(payInvoice({ ...wallet, id: 'guard-storage' }, 'invoice', { prompt: '', cancel: '' }, undefined, {
    check: () => {}, beforeSend: async () => { throw new Error('storage-failed'); },
  })).rejects.toThrow('storage-failed');
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});
it('does not publish a payment rejected by the trusted platform', async () => {
  jest.mocked(vaultAccess.execute).mockImplementation(async command => { if (command.method === 'walletRequest') throw new Error('Rejected'); return null; });
  await expect(payInvoice({ ...wallet, id: 'guard-rejected' }, 'invoice', { prompt: '', cancel: '' })).rejects.toMatchObject({ kind: 'authentication_failed' });
  expect(relayPool.publishEvent).not.toHaveBeenCalled();
});

it.each([undefined, 120_000])('retries wallet lookup at the eligible relay (hint %s)', async retryAfterMs => {
  const refused = 'wss://refused.example/';
  const limited = 'wss://limited.example/';
  jest.mocked(vaultAccess.execute).mockImplementation(async command => command.method === 'walletRequest'
    ? { event: { id: 'request' }, peer: wallet.walletPubkey, relays: [refused, limited] }
    : null);
  jest.mocked(relayPool.subscribe).mockReturnValue(jest.fn());
  jest.mocked(relayPool.publishEvent)
    .mockResolvedValueOnce([
      { url: refused, outcome: { ok: false, failure: 'rejected', reason: 'blocked: relay policy' } },
      { url: limited, outcome: { ok: false, failure: 'rate-limited', reason: 'rate-limited: slow down', retryAfterMs } },
    ])
    .mockResolvedValueOnce([{ url: limited, outcome: { ok: false, failure: 'rejected', reason: 'blocked: relay policy' } }]);

  jest.useFakeTimers();
  try {
    const lookup = lookupInvoiceStatus({ ...wallet, id: `wallet-relay-limits-${retryAfterMs}` }, { invoice: 'invoice' });
    await jest.advanceTimersByTimeAsync((retryAfterMs ?? 62_500) - 1);
    expect(relayPool.publishEvent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(lookup).resolves.toBe('unknown');
    expect(jest.mocked(relayPool.publishEvent).mock.calls.map(([request]) => request.relays))
      .toEqual([[refused, limited], [limited]]);
  } finally {
    jest.useRealTimers();
  }
});

it('ends the wallet lookup when the relay asks for a longer wait than the request budget', async () => {
  const url = 'wss://relay.example/';
  jest.mocked(relayPool.subscribe).mockReturnValue(jest.fn());
  jest.mocked(relayPool.publishEvent).mockResolvedValueOnce([
    { url, outcome: { ok: false, failure: 'rate-limited', reason: 'rate-limited: slow down', retryAfterMs: 300_000 } },
  ]);

  jest.useFakeTimers();
  try {
    const lookup = lookupInvoiceStatus({ ...wallet, id: 'wallet-long-relay-limit' }, { invoice: 'invoice' });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(lookup).resolves.toBe('unknown');
    expect(relayPool.publishEvent).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
