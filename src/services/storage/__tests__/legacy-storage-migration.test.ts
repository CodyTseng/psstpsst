const mockFrom = jest.fn();
const mockSelect = jest.fn(() => ({ from: mockFrom }));
const mockExecute = jest.fn();
const mockBunkerMigration = jest.fn();
const mockGetPreference = jest.fn();
const mockSetPreference = jest.fn();
const mockDeleteLegacyPreference = jest.fn();
jest.mock('@/db/client', () => ({ db: { select: mockSelect } }));
jest.mock('@/platform', () => ({ platform: { security: { deleteLegacyPreference: mockDeleteLegacyPreference } } }));
jest.mock('@/platform/vault-access', () => ({ vaultAccess: { execute: mockExecute } }));
jest.mock('@/services/account/account-access', () => ({ migrateNip46BunkerSecrets: mockBunkerMigration }));
jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: mockGetPreference, setDevicePreference: mockSetPreference,
  walletBalanceVisiblePreferenceKey: (account: string) => `wallet.balanceVisible.${account}`,
  legacyWalletBalanceVisiblePreferenceKey: (account: string) => `wallet.balanceVisible.${account.slice(0, 16)}`,
}));

let migrate: typeof import('../legacy-storage-migration').migrateLegacyStorage;
const active = 'a'.repeat(64), inactive = 'b'.repeat(64);
beforeEach(() => {
  jest.resetModules();
  jest.resetAllMocks();
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockFrom.mockResolvedValueOnce([{ pubkey: active }, { pubkey: inactive, signerType: 'nip46', signerPayload: JSON.stringify({ pubkey: 'd'.repeat(64), secret: null }) }])
    .mockResolvedValueOnce([{ account: inactive, walletId: 'legacy', peer: 'c'.repeat(64), relaysJson: '["wss://wallet.example/"]' }]);
  mockGetPreference.mockResolvedValue(null);
  migrate = jest.requireActual<typeof import('../legacy-storage-migration')>('../legacy-storage-migration').migrateLegacyStorage;
});

test('migrates inactive accounts and every legacy preference before recording completion', async () => {
  await migrate();
  expect(mockExecute).toHaveBeenCalledWith({ method: 'migrateStorage', accounts: [active, inactive], bunkers: [{ account: inactive, peer: 'd'.repeat(64) }],
    wallets: [{ account: inactive, walletId: 'legacy', peer: 'c'.repeat(64), relays: ['wss://wallet.example/'] }] });
  expect(mockBunkerMigration).toHaveBeenCalledTimes(1);
  expect(mockGetPreference).toHaveBeenCalledWith('theme.accent', 'theme.accent');
  expect(mockGetPreference).toHaveBeenCalledWith(`wallet.balanceVisible.${inactive}`, `wallet.balanceVisible.${inactive.slice(0, 16)}`);
  expect(mockDeleteLegacyPreference).toHaveBeenCalledWith('active_account_pubkey');
  expect(mockSetPreference).toHaveBeenCalledWith('storage.vaultMigration.v1', 'complete');
  expect(mockSetPreference.mock.invocationCallOrder[0]).toBeGreaterThan(mockDeleteLegacyPreference.mock.invocationCallOrder.at(-1)!);
  await migrate();
  expect(mockExecute).toHaveBeenCalledTimes(1);
});

test('an incomplete vault migration blocks completion and can be retried', async () => {
  mockExecute.mockRejectedValueOnce(new Error('Write failed'));
  await expect(migrate()).rejects.toThrow('Write failed');
  expect(mockSetPreference).not.toHaveBeenCalled();
  expect(mockDeleteLegacyPreference).not.toHaveBeenCalled();
  mockFrom.mockResolvedValueOnce([{ pubkey: active }]).mockResolvedValueOnce([]);
  await expect(migrate()).resolves.toBeUndefined();
  expect(mockExecute).toHaveBeenCalledTimes(2);
  expect(mockSetPreference).toHaveBeenCalledWith('storage.vaultMigration.v1', 'complete');
});

test('a completed upgrade does not rescan accounts or touch secure storage', async () => {
  mockGetPreference.mockResolvedValueOnce('complete');
  await migrate();
  expect(mockSelect).not.toHaveBeenCalled();
  expect(mockExecute).not.toHaveBeenCalled();
  expect(mockDeleteLegacyPreference).not.toHaveBeenCalled();
});

test('concurrent startup callers wait for the same unfinished migration', async () => {
  let finish!: () => void;
  let started!: () => void;
  const executionStarted = new Promise<void>(resolve => { started = resolve; });
  mockExecute.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; started(); }));
  const first = migrate(), second = migrate();
  expect(first).toBe(second);
  await executionStarted;
  expect(mockSetPreference).not.toHaveBeenCalled();
  finish();
  await Promise.all([first, second]);
  expect(mockSetPreference).toHaveBeenCalledTimes(1);
});
