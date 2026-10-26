import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAsyncDatabase } from '@/platform/create-async-database';
import type { SqliteExecutor, SqlBindValue } from '@/platform/ports/database';
import * as schema from '@/db/schema';

/** Shared async port over real SQLite for event-cache, snapshot and migration tests. */
export function applicationTestDatabase(legacy = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('account'),('other');");
  sqlite.exec(`CREATE TABLE replaceable_events(pubkey TEXT,kind INTEGER,d_tag TEXT,event TEXT,created_at INTEGER,fetched_at INTEGER,
    PRIMARY KEY(pubkey,kind,d_tag)); CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);`);
  for (const migration of ['0029_referenced_events', '0059_napplets', '0056_private-list-sync-state', '0062_explore', '0070_private-favorites', '0071_event-backed-applications', '0072_event-relay-sources']) {
    if (!legacy || !/^007[12]_/.test(migration)) sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/${migration}.sql`, 'utf8'));
  }
  let tail = Promise.resolve();
  const executor: SqliteExecutor = {
    async execute(query, params, method) {
      const statement = sqlite.prepare(query);
      const values = params as Exclude<SqlBindValue, boolean>[];
      if (method === 'run') { statement.run(...values); return { rows: [] }; }
      statement.setReturnArrays(true);
      return { rows: method === 'get' ? statement.get(...values) : statement.all(...values) };
    },
    transaction(task) {
      const run = tail.then(async () => {
        sqlite.exec('BEGIN');
        try { const result = await task(executor); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      tail = run.then(() => {}, () => {});
      return run;
    },
  };
  return { sqlite, db: createAsyncDatabase(executor, schema) };
}
