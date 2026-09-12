import { createAsyncDatabase } from '../create-async-database';
import type {
  SqlBindValue,
  SqliteDriver,
  SqliteExecutor,
  SqliteQueryMethod,
} from '../ports/database';
import { getElectronBridge } from './bridge';

function transactionExecutor(transactionId: string): SqliteExecutor {
  return {
    execute: (sql, params, method) =>
      getElectronBridge().database.execute(sql, params, method, transactionId),
    async transaction(task) {
      const nestedId = await getElectronBridge().database.begin(transactionId);
      try {
        const result = await task(transactionExecutor(nestedId));
        await getElectronBridge().database.commit(nestedId);
        return result;
      } catch (error) {
        await getElectronBridge().database.rollback(nestedId);
        throw error;
      }
    },
  };
}

export const electronDatabaseAdapter: SqliteDriver = {
  drizzle(schema) {
    return createAsyncDatabase(this, schema);
  },

  execute(sql: string, params: SqlBindValue[], method: SqliteQueryMethod) {
    return getElectronBridge().database.execute(sql, params, method);
  },

  async transaction(task) {
    const transactionId = await getElectronBridge().database.begin();
    try {
      const result = await task(transactionExecutor(transactionId));
      await getElectronBridge().database.commit(transactionId);
      return result;
    } catch (error) {
      await getElectronBridge().database.rollback(transactionId);
      throw error;
    }
  },

  exec(sql) {
    return getElectronBridge().database.exec(sql);
  },

  async rawQuery<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
    const rows: T[] = [];
    for await (const row of this.rawQueryEach<T>(sql, params)) rows.push(row);
    return rows;
  },

  async *rawQueryEach<T>(sql: string, params: SqlBindValue[] = []): AsyncIterable<T> {
    const streamId = await getElectronBridge().database.streamOpen(sql, params);
    try {
      let done = false;
      while (!done) {
        const batch = await getElectronBridge().database.streamNext<T>(streamId);
        done = batch.done;
        yield* batch.rows;
      }
    } finally {
      await getElectronBridge().database.streamClose(streamId);
    }
  },

  runBatch(sql, paramsBatch) {
    return getElectronBridge().database.runBatch(sql, paramsBatch);
  },

  addChangeListener(listener) {
    return getElectronBridge().database.onChange(listener);
  },
};
