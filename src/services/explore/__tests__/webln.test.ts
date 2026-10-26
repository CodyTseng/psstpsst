import { WebLn } from '../webln';
import { getWallets, payInvoice, makeInvoice, cacheLocalInvoiceTransaction, type WalletRow } from '@/services/wallet/wallet.service';
import { claimWebLnPayment } from '@/services/wallet/webln-payments';
import { invoiceFixture, preimage } from '@/services/wallet/testing/webln-invoice';
import { invalidateSigning, subscribeSigning } from '@/services/signing/changes';

jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/wallet/wallet.service', () => ({ getWallets: jest.fn(), payInvoice: jest.fn(), makeInvoice: jest.fn(),
  cacheLocalInvoiceTransaction: jest.fn(async () => ({})), walletSupportsMethod: (wallet: WalletRow, method: string) => !wallet.capabilitiesJson || JSON.parse(wallet.capabilitiesJson).includes(method) }));
jest.mock('@/services/wallet/webln-payments', () => ({ claimWebLnPayment: jest.fn(async () => {}) }));
const wallet = { id: 'wallet', accountPubkey: 'account', name: 'Wallet', capabilitiesJson: '["pay_invoice","make_invoice"]' } as WalletRow;
let life: AbortController, bridge: WebLn, confirm: jest.Mock, detach: () => void;
const scope = { accountPubkey: 'account', sourceId: 'https://site.example' };
beforeEach(() => {
  jest.clearAllMocks();
  life = new AbortController();
  detach = subscribeSigning(scope, () => {});
  confirm = jest.fn(async prompt => JSON.stringify({ walletId: 'wallet', ...(prompt.wallet?.amountRange ? { amountSats: 1 } : {}) }));
  bridge = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  jest.mocked(getWallets).mockResolvedValue([wallet]);
  jest.mocked(payInvoice).mockImplementation(async (_wallet, _invoice, _copy, _metadata, guard) => {
    guard?.check(); await guard?.beforeSend?.(); guard?.check(); return { preimage };
  });
});
afterEach(() => { life.abort(); detach(); });
async function enable() { await bridge.handle('enable', []); }
it('initializes without consent and exposes no NWC credentials or Nostr identity', async () => {
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('webln-not-enabled');
  await enable();
  await enable();
  expect(confirm).not.toHaveBeenCalled();
  expect(await bridge.handle('getInfo', [])).toEqual({ node: { alias: 'Wallet', pubkey: '' }, methods: ['getInfo', 'sendPayment', 'makeInvoice'] });
});
it('does not accept a remembered allow decision as payment consent', async () => {
  await enable(); confirm.mockResolvedValueOnce('allow-always');
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('permission-denied');
  expect(payInvoice).not.toHaveBeenCalled();
});
it('claims durably before sending, verifies the proof and caches a completed debit', async () => {
  await enable(); await expect(bridge.handle('sendPayment', [invoiceFixture()])).resolves.toEqual({ preimage });
  expect(claimWebLnPayment).toHaveBeenCalledTimes(1);
  expect(cacheLocalInvoiceTransaction).toHaveBeenLastCalledWith(wallet, expect.objectContaining({ state: 'settled', preimage }));
});
it('fails closed on durable claim failure and never retries a debit', async () => {
  await enable(); jest.mocked(claimWebLnPayment).mockRejectedValueOnce(new Error('payment-already-attempted'));
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('payment-already-attempted');
  expect(payInvoice).toHaveBeenCalledTimes(1);
  expect(cacheLocalInvoiceTransaction).not.toHaveBeenCalled();
});
it('rejects stale consent after source permission revocation', async () => {
  await enable(); confirm.mockImplementationOnce(async () => { invalidateSigning(scope); return 'allow'; });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('permission-revoked');
  expect(payInvoice).not.toHaveBeenCalled();
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
});
it('rechecks after authentication and cancels a replaced document before claiming', async () => {
  await enable();
  jest.mocked(payInvoice).mockImplementationOnce(async (_w, _i, _c, _m, guard) => {
    life.abort(); guard!.check(); await guard!.beforeSend!(); return { preimage };
  });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow();
  expect(claimWebLnPayment).not.toHaveBeenCalled();
});
it('retains completed payment accounting after document closure', async () => {
  await enable();
  jest.mocked(payInvoice).mockImplementationOnce(async (_w, _i, _c, _m, guard) => {
    await guard!.beforeSend!(); life.abort(); return { preimage };
  });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow();
  expect(cacheLocalInvoiceTransaction).toHaveBeenLastCalledWith(wallet, expect.objectContaining({ state: 'settled' }));
});
it('does not claim success for a bogus proof or leak wallet errors', async () => {
  await enable();
  jest.mocked(payInvoice).mockImplementationOnce(async (_w, _i, _c, _m, guard) => {
    await guard!.beforeSend!(); return { preimage: '00'.repeat(32) };
  });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('payment-result-uncertain-check-wallet');
  jest.mocked(getWallets).mockRejectedValueOnce(new Error('secret-connection-string'));
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('wallet-request-failed');
});
it('rejects attempts to inject a renderer-issued payment authorization', async () => {
  await enable();
  confirm.mockResolvedValueOnce(JSON.stringify({ walletId: 'wallet', pinAuthorization: 'forged-token' }));
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('permission-denied');
  expect(payInvoice).not.toHaveBeenCalled();
});
it('rejects malformed invoices before authentication and review', async () => {
  await enable(); confirm.mockClear();
  await expect(bridge.handle('sendPayment', ['lnbc1fake'])).rejects.toThrow();
  expect(confirm).not.toHaveBeenCalled(); expect(payInvoice).not.toHaveBeenCalled();
});
it('rejects a wallet removed while the payment is being reviewed', async () => {
  await enable();
  confirm.mockImplementationOnce(async () => { jest.mocked(getWallets).mockResolvedValue([]); return JSON.stringify({ walletId: 'wallet' }); });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('wallet-unavailable');
  expect(claimWebLnPayment).not.toHaveBeenCalled();
});
it('blocks concurrent wallet operations instead of queuing surprise payments', async () => {
  await enable(); let answer!: (value: string) => void;
  confirm.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const pending = bridge.handle('sendPayment', [invoiceFixture()]);
  await new Promise(resolve => setTimeout(resolve, 10));
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('wallet-request-pending');
  answer(JSON.stringify({ walletId: 'wallet' })); await pending;
});
it('enforces invoice amount constraints and checks the returned invoice', async () => {
  await enable(); const invoice = invoiceFixture(); jest.mocked(makeInvoice).mockResolvedValue({ invoice });
  await expect(bridge.handle('makeInvoice', [{ amount: 1, minimumAmount: 2 }])).rejects.toThrow('invalid-amount');
  await expect(bridge.handle('makeInvoice', [{ amount: 2 }])).rejects.toThrow('invalid-invoice-amount');
  confirm.mockResolvedValueOnce(JSON.stringify({ walletId: 'wallet', amountSats: 1 }));
  await expect(bridge.handle('makeInvoice', [{ minimumAmount: 1, maximumAmount: 10 }])).resolves.toEqual({ paymentRequest: invoice });
  expect(makeInvoice).toHaveBeenLastCalledWith(wallet, { amountMsat: 1000, description: '' }, expect.any(Object));
});

it('never retries a timed-out debit and leaves its pending transaction visible', async () => {
  await enable();
  jest.mocked(payInvoice).mockImplementationOnce(async (_w, _i, _c, _m, guard) => {
    await guard!.beforeSend!(); throw new Error('timeout with private wallet details');
  });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('payment-result-uncertain-check-wallet');
  expect(payInvoice).toHaveBeenCalledTimes(1);
  expect(cacheLocalInvoiceTransaction).toHaveBeenLastCalledWith(wallet, expect.objectContaining({ state: 'pending' }));
});
it('does not start a debit when the trusted platform rejects authentication', async () => {
  await enable();
  jest.mocked(payInvoice).mockRejectedValueOnce(new Error('authentication_failed'));
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('wallet-request-failed');
  expect(claimWebLnPayment).not.toHaveBeenCalled();
});
it('expires a payment review while authentication is still in progress', async () => {
  await enable(); const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    jest.mocked(payInvoice).mockImplementationOnce(async (_w, _i, _c, _m, guard) => {
      clock.mockReturnValue(now + 60001); guard!.check(); return { preimage };
    });
    await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('payment-review-expired');
    expect(claimWebLnPayment).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});
it('initializes each new document independently', async () => {
  await enable();
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', new AbortController().signal, confirm);
  await expect(next.handle('isEnabled', [])).resolves.toBe(false);
  await expect(next.handle('getInfo', [])).rejects.toThrow('webln-not-enabled');
});
it('advertises only supported wallet methods and refuses unsupported debits', async () => {
  await enable(); jest.mocked(getWallets).mockResolvedValue([{ ...wallet, capabilitiesJson: '["make_invoice"]' }]);
  await expect(bridge.handle('getInfo', [])).resolves.toMatchObject({ methods: ['getInfo', 'makeInvoice'] });
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('unsupported-method');
  expect(payInvoice).not.toHaveBeenCalled();
});

it('defers wallet selection until review and uses exactly the reviewed wallet', async () => {
  const second = { ...wallet, id: 'second', name: 'Second', isDefault: true };
  jest.mocked(getWallets).mockResolvedValue([wallet, second]);
  await enable();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce(JSON.stringify({ walletId: 'second' }));
  await bridge.handle('sendPayment', [invoiceFixture()]);
  expect(confirm.mock.calls[0][0].wallet.wallets).toHaveLength(2);
  expect(confirm.mock.calls[0][0].wallet.wallets[0]).not.toHaveProperty('relaysJson');
  expect(payInvoice).toHaveBeenCalledWith(second, expect.any(String), expect.any(Object), undefined, expect.any(Object));
});
it('refuses wallet IDs that were not offered for review', async () => {
  await enable();
  confirm.mockResolvedValueOnce(JSON.stringify({ walletId: 'not-offered' }));
  await expect(bridge.handle('sendPayment', [invoiceFixture()])).rejects.toThrow('permission-denied');
  expect(payInvoice).not.toHaveBeenCalled();
});
it('offers only eligible wallets even when the default wallet cannot pay', async () => {
  const readOnly = { ...wallet, id: 'read-only', isDefault: true, capabilitiesJson: '["make_invoice"]' };
  jest.mocked(getWallets).mockResolvedValue([readOnly, wallet]);
  await enable();
  await expect(bridge.handle('getInfo', [])).resolves.toMatchObject({ methods: ['getInfo', 'makeInvoice', 'sendPayment'] });
  await bridge.handle('sendPayment', [invoiceFixture()]);
  expect(confirm.mock.calls[0][0].wallet.wallets.map((row: { id: string }) => row.id)).toEqual(['wallet']);
});

it('keeps initialization enabled when signing permissions change', async () => {
  await enable(); invalidateSigning(scope);
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
  await enable();
  await expect(bridge.handle('getInfo', [])).resolves.toHaveProperty('methods');
  expect(confirm).not.toHaveBeenCalled();
});
it('rejects initialization without a connected wallet', async () => {
  jest.mocked(getWallets).mockResolvedValue([]);
  await expect(bridge.handle('enable', [])).rejects.toThrow('wallet-not-connected');
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});
