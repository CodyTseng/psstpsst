import { WebLn } from '../webln';
import { readBrowserPermissions, saveBrowserPermissions, type BrowserPermissionRule } from '../browser-permission-store';
import type { AppAuthorization } from '@/services/app-authorization/model';
import { readAppAuthorization, initializeAppAuthorization, assertCurrentSigningSource } from '@/services/signing/repository';
import { getWallets, payInvoice, makeInvoice, cacheLocalInvoiceTransaction, type WalletRow } from '@/services/wallet/wallet.service';
import { claimWebLnPayment } from '@/services/wallet/webln-payments';
import { invoiceFixture, preimage } from '@/services/wallet/testing/webln-invoice';
import { invalidateSigning, subscribeSigning } from '@/services/signing/changes';

jest.mock('../browser-permission-store', () => ({ readBrowserPermissions: jest.fn(), saveBrowserPermissions: jest.fn() }));
jest.mock('@/services/signing/repository', () => ({ assertCurrentSigningSource: jest.fn(async () => {}), readAppAuthorization: jest.fn(), initializeAppAuthorization: jest.fn() }));
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/wallet/wallet.service', () => ({ getWallets: jest.fn(), payInvoice: jest.fn(), makeInvoice: jest.fn(),
  cacheLocalInvoiceTransaction: jest.fn(async () => ({})), walletSupportsMethod: (wallet: WalletRow, method: string) => !wallet.capabilitiesJson || JSON.parse(wallet.capabilitiesJson).includes(method) }));
jest.mock('@/services/wallet/webln-payments', () => ({ claimWebLnPayment: jest.fn(async () => {}) }));
const wallet = { id: 'wallet', accountPubkey: 'account', name: 'Wallet', capabilitiesJson: '["pay_invoice","make_invoice"]' } as WalletRow;
let life: AbortController, bridge: WebLn, confirm: jest.Mock, detach: () => void;
const scope = { accountPubkey: 'account', sourceId: 'https://site.example' };
const savedRules = new Map<string, BrowserPermissionRule>();
const savedLevels = new Map<string, AppAuthorization | undefined>();
const ruleKey = (scope: { accountPubkey: string; sourceId: string }) => JSON.stringify([scope.accountPubkey, scope.sourceId]);
beforeEach(() => {
  jest.clearAllMocks();
  savedRules.clear(); savedLevels.clear();
  jest.mocked(readAppAuthorization).mockImplementation(async scope => {
    await assertCurrentSigningSource(scope);
    return savedLevels.has(ruleKey(scope)) ? savedLevels.get(ruleKey(scope)) : { fullyTrusted: false };
  });
  jest.mocked(initializeAppAuthorization).mockImplementation(async (scope, level, guard) => {
    guard?.(); savedLevels.set(ruleKey(scope), { fullyTrusted: level === 'trusted' });
    if (level === 'routine') savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 });
    return invalidateSigning(scope, 'level');
  });
  jest.mocked(readBrowserPermissions).mockImplementation(async scope => {
    await assertCurrentSigningSource(scope);
    const rule = savedRules.get(ruleKey(scope));
    return rule ? [rule] : [];
  });
  jest.mocked(saveBrowserPermissions).mockImplementation(async (scope, resources, decision, expiresAt, guard) => {
    guard?.();
    await assertCurrentSigningSource(scope);
    guard?.();
    savedRules.set(ruleKey(scope), { resource: resources[0], decision, expiresAt, updatedAt: Date.now() });
    return invalidateSigning(scope, 'browser:*');
  });
  life = new AbortController();
  detach = subscribeSigning(scope, () => {});
  confirm = jest.fn(async prompt => prompt.walletAccess ? 'allow' : JSON.stringify({ walletId: 'wallet', ...(prompt.wallet?.amountRange ? { amountSats: 1 } : {}) }));
  bridge = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  jest.mocked(getWallets).mockResolvedValue([wallet]);
  jest.mocked(payInvoice).mockImplementation(async (_wallet, _invoice, _copy, _metadata, guard) => {
    guard?.check(); await guard?.beforeSend?.(); guard?.check(); return { preimage };
  });
});
afterEach(() => { life.abort(); detach(); });
async function enable() { await bridge.handle('enable', []); confirm.mockClear(); }
it('initializes without consent and asks for information access for each one-time request', async () => {
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('webln-not-enabled');
  await bridge.handle('enable', []);
  await bridge.handle('enable', []);
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  const info = { node: { alias: 'Wallet', pubkey: '' }, methods: ['getInfo', 'sendPayment', 'makeInvoice'] };
  await expect(bridge.handle('getInfo', [])).resolves.toEqual(info);
  await expect(bridge.handle('getInfo', [])).resolves.toEqual(info);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ walletAccess: true,
    requester: { title: 'Site', origin: scope.sourceId } }), life.signal);
});
it('keeps initialization after information access denial and permits an explicit retry', async () => {
  await enable();
  confirm.mockResolvedValueOnce(false);
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('withholds information when its origin is revoked during consent', async () => {
  await enable();
  confirm.mockImplementationOnce(async () => { invalidateSigning(scope); return 'allow'; });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-revoked');
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('reviews payments directly after initialization even when information access was denied', async () => {
  await enable();
  confirm.mockResolvedValueOnce(false);
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  confirm.mockClear();
  await bridge.handle('sendPayment', [invoiceFixture()]);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0]).toMatchObject({ wallet: { operation: 'payment' } });
});
it('reviews invoice creation directly after initialization', async () => {
  await enable();
  jest.mocked(makeInvoice).mockResolvedValue({ invoice: invoiceFixture() });
  await bridge.handle('makeInvoice', [{ amount: 1 }]);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0]).toMatchObject({ wallet: { operation: 'invoice' } });
});
it('rechecks wallet availability before returning approved information', async () => {
  await enable();
  confirm.mockImplementationOnce(async () => { jest.mocked(getWallets).mockResolvedValue([]); return 'allow'; });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('wallet-not-connected');
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(false);
  jest.mocked(getWallets).mockResolvedValue([wallet]);
  await enable();
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(1);
});
it('does not disclose information after the requesting document closes during consent', async () => {
  await enable();
  confirm.mockImplementationOnce(async () => { life.abort(); return 'allow'; });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow();
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
  expect(confirm.mock.calls[1][0].wallet.wallets.map((row: { id: string }) => row.id)).toEqual(['wallet']);
});

it('keeps initialization but renews information consent when source permissions change', async () => {
  await enable();
  await bridge.handle('getInfo', []);
  invalidateSigning(scope);
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(true);
  await bridge.handle('enable', []);
  expect(confirm).toHaveBeenCalledTimes(1);
  await expect(bridge.handle('getInfo', [])).resolves.toHaveProperty('methods');
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('does not reuse one-time information consent in a new document', async () => {
  await enable();
  await bridge.handle('getInfo', []);
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', new AbortController().signal, confirm);
  await next.handle('enable', []);
  expect(confirm).toHaveBeenCalledTimes(1);
  await next.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('rejects initialization without a connected wallet', async () => {
  jest.mocked(getWallets).mockResolvedValue([]);
  await expect(bridge.handle('enable', [])).rejects.toThrow('wallet-not-connected');
  await expect(bridge.handle('isEnabled', [])).resolves.toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['allow-always', 'allow-10m', 'allow-1h', 'allow-24h'])('reuses %s information consent across documents', async answer => {
  await enable();
  confirm.mockResolvedValueOnce(answer);
  const now = Date.now();
  await bridge.handle('getInfo', []);
  const expectedExpiry = answer === 'allow-always' ? null : expect.any(Number);
  expect(saveBrowserPermissions).toHaveBeenCalledWith(scope, ['webln-info'], 'allow', expectedExpiry, expect.any(Function));
  if (answer === 'allow-1h') expect(savedRules.get(ruleKey(scope))!.expiresAt).toBeGreaterThanOrEqual(now + 3600000);
  await bridge.handle('getInfo', []);
  life.abort();
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', new AbortController().signal, confirm);
  await next.handle('enable', []);
  await expect(next.handle('getInfo', [])).resolves.toHaveProperty('node');
  expect(confirm).toHaveBeenCalledTimes(1);
});
it.each(['deny-always', 'deny-10m', 'deny-1h', 'deny-24h'])('remembers %s without blocking separately reviewed payments', async answer => {
  await enable();
  confirm.mockResolvedValueOnce(answer);
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  await next.handle('enable', []);
  await expect(next.handle('getInfo', [])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(savedRules.get(ruleKey(scope))!.decision).toBe('deny');
  await next.handle('sendPayment', [invoiceFixture()]);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm.mock.calls[1][0]).toMatchObject({ wallet: { operation: 'payment' } });
});
it.each(['allow', 'deny'] as const)('asks again after a saved %s expires', async decision => {
  await enable();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  try {
    savedRules.set(ruleKey(scope), { resource: 'webln-info', decision, expiresAt: 1000001, updatedAt: 1 });
    if (decision === 'allow') await bridge.handle('getInfo', []);
    else await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
    expect(confirm).not.toHaveBeenCalled();
    clock.mockReturnValue(1000001);
    await bridge.handle('getInfo', []);
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); }
});
it('rechecks stored rules for revocation and denial from another window', async () => {
  await enable();
  confirm.mockResolvedValueOnce('allow-always');
  await bridge.handle('getInfo', []);
  savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'deny', expiresAt: null, updatedAt: 1 });
  invalidateSigning(scope, 'browser:*');
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledTimes(1);
  savedRules.delete(ruleKey(scope));
  invalidateSigning(scope, 'browser:*');
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('isolates durable information consent by account and verified source', async () => {
  await enable();
  confirm.mockResolvedValueOnce('allow-always');
  await bridge.handle('getInfo', []);
  for (const [account, source] of [['other-account', scope.sourceId], [scope.accountPubkey, 'https://other.example']]) {
    const next = new WebLn(account, source, 'Other', life.signal, confirm);
    await next.handle('enable', []);
    await next.handle('getInfo', []);
    expect(readBrowserPermissions).toHaveBeenLastCalledWith({ accountPubkey: account, sourceId: source }, 'webln-info');
  }
  expect(confirm).toHaveBeenCalledTimes(3);
});
it.each(['allow-always', 'allow-1h', 'deny-always'])('rechecks queued information requests after saving %s', async answer => {
  await enable();
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  await next.handle('enable', []);
  let decide!: (answer: string) => void;
  confirm.mockImplementationOnce(() => new Promise(resolve => { decide = resolve; }));
  const requests = [bridge.handle('getInfo', []), next.handle('getInfo', [])];
  while (!confirm.mock.calls.length) await Promise.resolve();
  expect(confirm).toHaveBeenCalledTimes(1);
  decide(answer);
  const results = await Promise.allSettled(requests);
  expect(results.map(result => result.status)).toEqual(answer.startsWith('allow') ? ['fulfilled', 'fulfilled'] : ['rejected', 'rejected']);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(saveBrowserPermissions).toHaveBeenCalledTimes(1);
});
it.each(['close', 'revoke'] as const)('does not persist information consent after document %s during review', async action => {
  await enable();
  confirm.mockImplementationOnce(async () => {
    if (action === 'close') life.abort(); else invalidateSigning(scope);
    return 'allow-always';
  });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow();
  expect(saveBrowserPermissions).not.toHaveBeenCalled();
});
it('fails closed when saving information consent fails', async () => {
  await enable();
  confirm.mockResolvedValueOnce('allow-always');
  jest.mocked(saveBrowserPermissions).mockRejectedValueOnce(new Error('database-private-details'));
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('wallet-request-failed');
  expect(savedRules.size).toBe(0);
});
it('withholds information if its timed grant expires during the wallet query', async () => {
  await enable();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  try {
    savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'allow', expiresAt: 1000001, updatedAt: 1 });
    jest.mocked(getWallets).mockResolvedValueOnce([wallet]).mockImplementationOnce(async () => { clock.mockReturnValue(1000001); return [wallet]; });
    await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-revoked');
  } finally { clock.mockRestore(); }
});
it('passes local application version preconditions into information reads and writes', async () => {
  const next = new WebLn(scope.accountPubkey, 'local~app', 'Local', life.signal, confirm, 'v1');
  await next.handle('enable', []);
  confirm.mockResolvedValueOnce('allow-always');
  await next.handle('getInfo', []);
  const versioned = { accountPubkey: scope.accountPubkey, sourceId: 'local~app', localVersion: 'v1' };
  expect(readBrowserPermissions).toHaveBeenCalledWith(versioned, 'webln-info');
  expect(saveBrowserPermissions).toHaveBeenCalledWith(versioned, ['webln-info'], 'allow', null, expect.any(Function));
});

it('keeps durable information consent independent of signer policy changes', async () => {
  await enable();
  confirm.mockResolvedValueOnce('allow-always');
  await bridge.handle('getInfo', []);
  invalidateSigning(scope, 'level');
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(1);
});
it('withholds approved information when another window revokes access during the wallet query', async () => {
  await enable();
  savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 });
  jest.mocked(getWallets).mockResolvedValueOnce([wallet]).mockImplementationOnce(async () => {
    savedRules.delete(ruleKey(scope));
    invalidateSigning(scope, 'browser:*');
    return [wallet];
  });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-revoked');
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['trusted'] as const)('allows wallet information under %s without reviewing or loading individual rules', async level => {
  savedLevels.set(ruleKey(scope), { fullyTrusted: level === 'trusted' });
  savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'deny', expiresAt: null, updatedAt: 1 });
  await enable();
  await expect(bridge.handle('getInfo', [])).resolves.toEqual({ node: { alias: 'Wallet', pubkey: '' }, methods: ['getInfo', 'sendPayment', 'makeInvoice'] });
  expect(confirm).not.toHaveBeenCalled();
  expect(readBrowserPermissions).not.toHaveBeenCalled();
  expect(saveBrowserPermissions).not.toHaveBeenCalled();
  expect(savedRules.get(ruleKey(scope))!.decision).toBe('deny');
});
it.each(['manual', 'routine', 'trusted'] as const)('selects %s on the first information read and then applies its policy', async level => {
  savedLevels.set(ruleKey(scope), undefined);
  await enable();
  expect(readAppAuthorization).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce(level);
  await bridge.handle('getInfo', []);
  expect(confirm.mock.calls[0][0]).toMatchObject({ appAuthorizationLevel: true, accountPubkey: scope.accountPubkey,
    requester: { title: 'Site', origin: scope.sourceId } });
  expect(initializeAppAuthorization).toHaveBeenCalledWith(scope, level, expect.any(Function));
  expect(confirm).toHaveBeenCalledTimes(level === 'manual' ? 2 : 1);
  if (level === 'manual') expect(confirm.mock.calls[1][0]).toMatchObject({ walletAccess: true });
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  await next.handle('enable', []);
  await next.handle('getInfo', []);
  expect(initializeAppAuthorization).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(level === 'manual' ? 3 : 1);
});
it.each([false, 'allow-always', 'invalid'] as const)('rejects a first information read when level selection returns %s', async answer => {
  savedLevels.set(ruleKey(scope), undefined);
  await enable();
  confirm.mockResolvedValueOnce(answer);
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  expect(initializeAppAuthorization).not.toHaveBeenCalled();
  expect(readBrowserPermissions).not.toHaveBeenCalled();
  expect(saveBrowserPermissions).not.toHaveBeenCalled();
});
it('withholds information when saving the selected level fails', async () => {
  savedLevels.set(ruleKey(scope), undefined);
  await enable();
  confirm.mockResolvedValueOnce('routine');
  jest.mocked(initializeAppAuthorization).mockRejectedValueOnce(new Error('disk-full'));
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('wallet-request-failed');
  expect(readBrowserPermissions).not.toHaveBeenCalled();
});
it('selects a level once for concurrent documents', async () => {
  savedLevels.set(ruleKey(scope), undefined);
  await enable();
  const next = new WebLn(scope.accountPubkey, scope.sourceId, 'Site', life.signal, confirm);
  await next.handle('enable', []);
  confirm.mockResolvedValueOnce('routine');
  const results = await Promise.all([bridge.handle('getInfo', []), next.handle('getInfo', [])]);
  expect(results).toHaveLength(2);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(initializeAppAuthorization).toHaveBeenCalledTimes(1);
});
it('restores saved refusals after disabling full trust', async () => {
  savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'deny', expiresAt: null, updatedAt: 1 });
  savedLevels.set(ruleKey(scope), { fullyTrusted: true });
  await enable();
  await bridge.handle('getInfo', []);
  savedLevels.set(ruleKey(scope), { fullyTrusted: false });
  invalidateSigning(scope, 'level');
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-denied');
  expect(confirm).not.toHaveBeenCalled();
});
it('reviews after a downgrade to Manual without a saved decision', async () => {
  savedLevels.set(ruleKey(scope), { fullyTrusted: true });
  await enable();
  await bridge.handle('getInfo', []);
  savedLevels.set(ruleKey(scope), { fullyTrusted: false });
  invalidateSigning(scope, 'level');
  await bridge.handle('getInfo', []);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0]).toMatchObject({ walletAccess: true });
});
it.each(['routine', 'trusted'] as const)('still reviews every payment and invoice under %s', async level => {
  savedLevels.set(ruleKey(scope), { fullyTrusted: level === 'trusted' });
  if (level === 'routine') savedRules.set(ruleKey(scope), { resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 });
  await enable();
  await bridge.handle('getInfo', []);
  await bridge.handle('sendPayment', [invoiceFixture()]);
  jest.mocked(makeInvoice).mockResolvedValue({ invoice: invoiceFixture() });
  await bridge.handle('makeInvoice', [{ amount: 1 }]);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm.mock.calls.map(call => call[0].wallet.operation)).toEqual(['payment', 'invoice']);
});
it('withholds automatically allowed information if the level is downgraded during the wallet query', async () => {
  savedLevels.set(ruleKey(scope), { fullyTrusted: false });
  await enable();
  jest.mocked(getWallets).mockResolvedValueOnce([wallet]).mockImplementationOnce(async () => {
    savedLevels.set(ruleKey(scope), { fullyTrusted: false });
    invalidateSigning(scope, 'level');
    return [wallet];
  });
  await expect(bridge.handle('getInfo', [])).rejects.toThrow('permission-revoked');
});
