import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

/** A bindable SQL value — matches what embedded SQLite drivers accept. */
export type SqlBindValue = string | number | boolean | null | Uint8Array;

/** Async Drizzle proxy shared by every database adapter. */
export type AsyncSqliteDatabase<TSchema extends Record<string, unknown>> = Omit<
  SqliteRemoteDatabase<TSchema>,
  'transaction'
> & {
  transaction<T>(task: (tx: AsyncSqliteDatabase<TSchema>) => Promise<T>): Promise<T>;
};

export type SqliteQueryMethod = 'run' | 'all' | 'values' | 'get';

/** One serialized database connection, optionally scoped to a transaction. */
export interface SqliteExecutor {
  execute(
    sql: string,
    params: SqlBindValue[],
    method: SqliteQueryMethod,
  ): Promise<{ rows: unknown }>;
  transaction<T>(task: (tx: SqliteExecutor) => Promise<T>): Promise<T>;
}

/**
 * Port for the app's SQLite database. Owns driver construction (ORM binding
 * included) and the raw-SQL escape hatches that Drizzle can't express (FTS5
 * `MATCH` + `snippet()`, streaming exports, prepared-statement bulk writes).
 *
 * Every database operation is asynchronous. Subscription registration and ORM
 * proxy construction are non-I/O and remain synchronous.
 */
export interface SqliteDriver extends SqliteExecutor {
  /**
   * Build the Drizzle handle over this database. The schema is supplied by the
   * caller (`db/client`) so the port stays app-agnostic; the adapter picks the
   * matching Drizzle driver binding.
   */
  drizzle<TSchema extends Record<string, unknown>>(schema: TSchema): AsyncSqliteDatabase<TSchema>;
  /** Execute a statement with no results (DDL, PRAGMA). */
  exec(sql: string): Promise<void>;
  /** Raw SQL query returning all rows (FTS5 `MATCH` + `snippet()`, bounded reads). */
  rawQuery<T>(sql: string, params?: SqlBindValue[]): Promise<T[]>;
  /** Stream rows one at a time (bounded-memory export of large histories). */
  rawQueryEach<T>(sql: string, params?: SqlBindValue[]): AsyncIterable<T>;
  /** Execute one statement over a batch of parameter rows (prepared-statement bulk writes). */
  runBatch(sql: string, paramsBatch: SqlBindValue[][]): Promise<void>;
  /**
   * Subscribe to data changes — backs the live-query wrapper in
   * `db/use-live-query.ts`. Returns an unsubscribe function.
   */
  addChangeListener(listener: (event: { tableName?: string }) => void): () => void;
}
