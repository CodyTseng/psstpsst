import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DatabaseSync } from 'node:sqlite';

import { db } from '@/db/client';
import { walletTransactions } from '@/db/schema';
import { useWalletTransactions } from '../use-wallets';

jest.mock('@/db/client', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { drizzle } = jest.requireActual('drizzle-orm/sqlite-proxy');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.function('strftime', (_format: string, _time: string) => String(Math.floor(Date.now() / 1000)));
  sqlite.exec(`CREATE TABLE wallet_transactions (
    id TEXT PRIMARY KEY, wallet_id TEXT, account_pubkey TEXT, type TEXT, state TEXT,
    invoice TEXT, description TEXT, payment_hash TEXT, preimage TEXT,
    amount_msat INTEGER, fees_paid_msat INTEGER, created_at INTEGER,
    expires_at INTEGER, settled_at INTEGER, raw_json TEXT, updated_at INTEGER
  )`);
  return {
    sqlite,
    db: drizzle(async (query: string, params: unknown[], method: string) => {
      const statement = sqlite.prepare(query);
      statement.setReturnArrays(true);
      if (method === 'run') {
        statement.run(...params);
        return { rows: [] };
      }
      return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
    }),
  };
});

jest.mock('@/platform', () => ({
  platform: { database: { addChangeListener: jest.fn(() => () => {}) } },
}));

const sqlite = (jest.requireMock('@/db/client') as { sqlite: DatabaseSync }).sqlite;
const NOW = 1_800_000_000;

describe('recent wallet transactions', () => {
  let renderer: ReactTestRenderer | undefined;
  let result: ReturnType<typeof useWalletTransactions>;
  let prepareSpy: jest.SpyInstance;

  function Harness({ walletId = 'wallet' }: { walletId?: string }) {
    result = useWalletTransactions(walletId);
    return null;
  }

  async function insert(
    id: string,
    overrides: Partial<typeof walletTransactions.$inferInsert> = {},
  ) {
    await db.insert(walletTransactions).values({
      id,
      walletId: 'wallet',
      accountPubkey: 'account',
      type: 'incoming',
      state: 'pending',
      createdAt: NOW,
      expiresAt: NOW + 60,
      rawJson: '{}',
      updatedAt: NOW,
      ...overrides,
    });
  }

  async function mount() {
    await act(async () => {
      renderer = create(<Harness />);
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW * 1000);
    sqlite.exec('DELETE FROM wallet_transactions');
    prepareSpy = jest.spyOn(sqlite, 'prepare');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    prepareSpy.mockRestore();
    jest.useRealTimers();
  });

  afterAll(() => sqlite.close());

  it('includes unexpired pending records and completed payments after invoice expiry', async () => {
    await insert('pending');
    await insert('no-expiry', { expiresAt: null });
    await insert('expired-by-time', { expiresAt: NOW });
    await insert('expired-state', { state: 'expired' });
    await insert('failed', { state: 'failed' });
    await insert('canceled', { state: 'canceled' });
    await insert('settled', { state: 'settled', expiresAt: NOW - 60 });
    await insert('other-wallet', { walletId: 'other' });
    await mount();

    expect(result.loaded).toBe(true);
    expect(result.transactions.map((row) => row.id).sort()).toEqual(['no-expiry', 'pending', 'settled']);
  });

  it('removes pending records at expiry without requiring a database change', async () => {
    await insert('first', { expiresAt: NOW + 5 });
    await insert('second', { expiresAt: NOW + 10 });
    await insert('settled', { state: 'settled', expiresAt: NOW + 5 });
    await mount();

    await act(async () => { jest.advanceTimersByTime(5_000); });
    expect(result.transactions.map((row) => row.id).sort()).toEqual(['second', 'settled']);
    await act(async () => { jest.advanceTimersByTime(5_000); });
    expect(result.transactions.map((row) => row.id)).toEqual(['settled']);
    const queryCount = prepareSpy.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(prepareSpy).toHaveBeenCalledTimes(queryCount);
  });

  it('keeps the query bounded and fills the window when a pending record expires', async () => {
    for (let index = 0; index < 35; index++) {
      await insert(`settled-${index}`, { state: 'settled', createdAt: NOW - index - 1 });
    }
    await insert('pending', { expiresAt: NOW + 1 });
    await mount();

    expect(result.transactions).toHaveLength(30);
    expect(result.transactions[0].id).toBe('pending');
    expect(result.transactions[29].id).toBe('settled-28');

    await act(async () => { jest.advanceTimersByTime(1_000); });
    expect(result.transactions).toHaveLength(30);
    expect(result.transactions[0].id).toBe('settled-0');
    expect(result.transactions[29].id).toBe('settled-29');
  });

  it('cancels the previous wallet expiry timer when switching wallets', async () => {
    await insert('pending');
    await insert('other-settled', { walletId: 'other', state: 'settled' });
    await mount();

    await act(async () => { renderer?.update(<Harness walletId="other" />); });
    expect(result.transactions.map((row) => row.id)).toEqual(['other-settled']);
    const queryCount = prepareSpy.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(prepareSpy).toHaveBeenCalledTimes(queryCount);
  });
});
