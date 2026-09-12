import { addDatabaseChangeListener, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { createAsyncDatabase } from '../create-async-database';
import type {
  SqlBindValue,
  SqliteDriver,
  SqliteExecutor,
  SqliteQueryMethod,
} from '../ports/database';

/** Wait through short writer contention from another Android runtime/inspector. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const sqlitePromise = openDatabaseAsync('psstpsst.db', { enableChangeListener: true }).then(
  async (sqlite) => {
    // WAL lets readers continue while a writer commits. `busy_timeout` covers
    // the remaining short writer/writer overlap from a headless task or the
    // development inspector instead of failing an otherwise valid upsert.
    await sqlite.execAsync(`
      PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
    return sqlite;
  },
);

type DatabaseChangeListener = (event: { tableName?: string }) => void;

const databaseChangeListeners = new Set<DatabaseChangeListener>();
let nativeDatabaseChangeSubscription: ReturnType<typeof addDatabaseChangeListener> | null = null;

function subscribeToDatabaseChanges(listener: DatabaseChangeListener): () => void {
  databaseChangeListeners.add(listener);
  if (!nativeDatabaseChangeSubscription) {
    nativeDatabaseChangeSubscription = addDatabaseChangeListener((event) => {
      for (const current of databaseChangeListeners) current(event);
    });
  }

  return () => {
    databaseChangeListeners.delete(listener);
    if (databaseChangeListeners.size > 0) return;
    nativeDatabaseChangeSubscription?.remove();
    nativeDatabaseChangeSubscription = null;
  };
}

let serializedTail: Promise<void> = Promise.resolve();

function acquireSerialized(): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitFor = serializedTail;
  serializedTail = waitFor.then(() => gate);
  return waitFor.then(() => release);
}

async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const release = await acquireSerialized();
  try {
    return await task();
  } finally {
    release();
  }
}

async function executeOn(
  sqlite: SQLiteDatabase,
  sql: string,
  params: SqlBindValue[],
  method: SqliteQueryMethod,
): Promise<{ rows: unknown }> {
  const statement = await sqlite.prepareAsync(sql);
  try {
    const result = await statement.executeForRawResultAsync(params);
    if (method === 'run') return { rows: [] };
    if (method === 'get') return { rows: (await result.getFirstAsync()) ?? undefined };
    return { rows: await result.getAllAsync() };
  } finally {
    await statement.finalizeAsync();
  }
}

function transactionExecutor(sqlite: SQLiteDatabase): SqliteExecutor {
  return {
    execute: (sql, params, method) => executeOn(sqlite, sql, params, method),
    async transaction(task) {
      const savepoint = `psstpsst_nested_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await sqlite.execAsync(`SAVEPOINT ${savepoint}`);
      try {
        const value = await task(transactionExecutor(sqlite));
        await sqlite.execAsync(`RELEASE SAVEPOINT ${savepoint}`);
        return value;
      } catch (error) {
        await sqlite.execAsync(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await sqlite.execAsync(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
  };
}

export const databaseAdapter: SqliteDriver = {
  drizzle(schema) {
    return createAsyncDatabase(this, schema);
  },

  execute(sql, params, method) {
    return serialized(async () => executeOn(await sqlitePromise, sql, params, method));
  },

  transaction(task) {
    return serialized(async () => {
      const sqlite = await sqlitePromise;
      let result: Awaited<ReturnType<typeof task>>;
      // Web has no exclusive-transaction API. The adapter-wide queue prevents
      // other operations from interleaving while this callback owns the handle.
      await sqlite.withTransactionAsync(async () => {
        result = await task(transactionExecutor(sqlite));
      });
      return result!;
    });
  },

  async exec(sql) {
    await serialized(async () => (await sqlitePromise).execAsync(sql));
  },

  rawQuery<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
    return serialized(async () => (await sqlitePromise).getAllAsync<T>(sql, params));
  },

  async *rawQueryEach<T>(sql: string, params: SqlBindValue[] = []): AsyncIterable<T> {
    const release = await acquireSerialized();
    try {
      const sqlite = await sqlitePromise;
      for await (const row of sqlite.getEachAsync<T>(sql, params)) yield row;
    } finally {
      release();
    }
  },

  async runBatch(sql, paramsBatch) {
    await this.transaction(async (executor) => {
      for (const params of paramsBatch) await executor.execute(sql, params, 'run');
    });
  },

  addChangeListener(listener) {
    return subscribeToDatabaseChanges(listener);
  },
};
