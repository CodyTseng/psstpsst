const mockExecAsync = jest.fn(async (_sql: string) => {});

jest.mock('expo-sqlite', () => ({
  addDatabaseChangeListener: jest.fn(() => ({ remove: jest.fn() })),
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: mockExecAsync,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after the native mock
const databaseModule = require('../database') as typeof import('../database');

describe('Expo database adapter', () => {
  it('opens SQLite in WAL mode with a bounded busy timeout', async () => {
    await databaseModule.databaseAdapter.exec('SELECT 1');

    expect(mockExecAsync).toHaveBeenCalledTimes(2);
    expect(mockExecAsync.mock.calls[0][0]).toContain('PRAGMA journal_mode = WAL;');
    expect(mockExecAsync.mock.calls[0][0]).toContain('PRAGMA foreign_keys = ON;');
    expect(mockExecAsync.mock.calls[0][0]).toContain(
      `PRAGMA busy_timeout = ${databaseModule.SQLITE_BUSY_TIMEOUT_MS};`,
    );
    expect(mockExecAsync).toHaveBeenLastCalledWith('SELECT 1');
  });
});
