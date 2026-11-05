import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqliteExecutor } from '@/platform/ports/database';

import * as schema from '@/db/schema';
import { createAsyncDatabase } from '@/platform/create-async-database';

/** Real migrations and serialized async transactions, shared by delivery tests. */
export function createNotificationDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = `${process.cwd()}/src/db/migrations`;
  for (const name of readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  const execute = async (sql: string, params: unknown[], method: string) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true);
    if (method === 'run') { statement.run(...params as SQLInputValue[]); return { rows: [] }; }
    return { rows: method === 'get' ? statement.get(...params as SQLInputValue[]) : statement.all(...params as SQLInputValue[]) };
  };
  let tail = Promise.resolve();
  const serialized = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  };
  const executor = {
    execute: (sql: string, params: unknown[], method: string) => serialized(() => execute(sql, params, method)),
    transaction: <T,>(task: (tx: { execute: typeof execute }) => Promise<T>) => serialized(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const value = await task({ execute });
        sqlite.exec('COMMIT');
        return value;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }),
  };
  return { sqlite, db: createAsyncDatabase(executor as unknown as SqliteExecutor, schema), createHandle: () => createAsyncDatabase(executor as unknown as SqliteExecutor, schema) };
}
