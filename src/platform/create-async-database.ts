import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';

import type { AsyncSqliteDatabase, SqliteExecutor } from './ports/database';

/**
 * Bind Drizzle's async SQLite proxy to a platform executor. Each transaction
 * gets a new proxy closed over its transaction-scoped executor, keeping the
 * transaction boundary explicit for any future adapter implementation.
 */
export function createAsyncDatabase<TSchema extends Record<string, unknown>>(
  executor: SqliteExecutor,
  schema: TSchema,
): AsyncSqliteDatabase<TSchema> {
  const database = drizzleProxy(
    async (sql, params, method) => {
      const result = await executor.execute(sql, params, method);
      return { rows: result.rows as unknown[] };
    },
    { schema },
  ) as unknown as AsyncSqliteDatabase<TSchema>;

  database.transaction = async <T>(
    task: (tx: AsyncSqliteDatabase<TSchema>) => Promise<T>,
  ): Promise<T> =>
    executor.transaction(async (transactionExecutor) =>
      task(createAsyncDatabase(transactionExecutor, schema)),
    );

  return database;
}
