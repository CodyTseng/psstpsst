import { is, sql } from 'drizzle-orm';
import { SQL } from 'drizzle-orm/sql';
import {
  getTableConfig,
  getViewConfig,
  SQLiteTable,
  SQLiteView,
} from 'drizzle-orm/sqlite-core';
import { SQLiteRelationalQuery } from 'drizzle-orm/sqlite-core/query-builders/query';
import { Subquery } from 'drizzle-orm/subquery';
import { useEffect, useMemo, useState } from 'react';

import { platform } from '@/platform';

import type { Database } from './client';

type QueryLike<T> = PromiseLike<T> & {
  config?: { table?: unknown };
  mode?: unknown;
  table?: unknown;
};

type MigrationBundle = {
  journal: {
    entries: { idx: number; when: number; tag: string }[];
  };
  migrations: Record<string, string>;
};

async function migrateDatabase(db: Database, bundle: MigrationBundle): Promise<void> {
  const migrations = bundle.journal.entries.map((entry) => {
    const source = bundle.migrations[`m${entry.idx.toString().padStart(4, '0')}`];
    if (!source) throw new Error(`Missing migration: ${entry.tag}`);
    return {
      statements: source.split('--> statement-breakpoint'),
      createdAt: entry.when,
    };
  });

  await db.transaction(async (tx) => {
    await tx.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `));
    const rows = (await tx.values(
      sql.raw(
        'SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      ),
    )) as unknown[][];
    const latestCreatedAt = rows[0] ? Number(rows[0][2]) : undefined;

    for (const migration of migrations) {
      if (latestCreatedAt !== undefined && latestCreatedAt >= migration.createdAt) continue;
      for (const statement of migration.statements) await tx.run(sql.raw(statement));
      await tx.run(
        sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${''}, ${migration.createdAt})`,
      );
    }
  });
}

/**
 * Driver-neutral async live query. Each adapter supplies database-change
 * notifications through the same port, so a future desktop backend can re-run
 * after its host broadcasts committed changes. Results survive dependency changes
 * until the replacement query resolves, matching the previous hook contract.
 */
export function useLiveQuery<T>(
  query: QueryLike<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled !== false;
  const relationalQuery = is(query as unknown, SQLiteRelationalQuery)
    ? (query as unknown as { mode: 'many' | 'first'; table: unknown })
    : null;
  // This token changes during render with the caller's dependency set. Unlike
  // `updatedAt`, it immediately distinguishes retained results for a previous
  // query from results resolved for the query currently being rendered.
  // The caller supplies the dependency list, just as it does for the query
  // effect below.
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps
  const dependencyToken = useMemo(() => Symbol('live-query'), deps);
  const [data, setData] = useState<T>(() =>
    (relationalQuery?.mode === 'first' ? undefined : []) as T,
  );
  const [error, setError] = useState<Error>();
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [resolvedDependencyToken, setResolvedDependencyToken] = useState<symbol | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const entity = relationalQuery?.table ?? query.config?.table;
    if (is(entity, Subquery) || is(entity, SQL)) {
      setError(new Error('Selecting from subqueries and SQL are not supported in useLiveQuery'));
      return;
    }

    let active = true;
    let inFlight = false;
    let dirty = false;
    let scheduled = false;
    let rerunTimer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!active || scheduled) return;
      scheduled = true;
      // sqlite3_update_hook reports every changed row. Coalesce a transaction's
      // burst before it can enqueue the same live query repeatedly.
      rerunTimer = setTimeout(() => {
        scheduled = false;
        rerunTimer = null;
        run();
      }, 0);
    };
    const run = () => {
      if (!active) return;
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      Promise.resolve(query).then(
        (next) => {
          if (!active) return;
          setData(next);
          setError(undefined);
          setUpdatedAt(new Date());
          setResolvedDependencyToken(dependencyToken);
        },
        (reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
        },
      ).finally(() => {
        inFlight = false;
        if (!active || !dirty) return;
        dirty = false;
        schedule();
      });
    };

    run();
    let tableName: string | undefined;
    if (is(entity, SQLiteTable)) tableName = getTableConfig(entity).name;
    else if (is(entity, SQLiteView)) tableName = getViewConfig(entity).name;
    const unsubscribe = platform.database.addChangeListener((event) => {
      if (!tableName || !event.tableName || event.tableName === tableName) schedule();
    });
    return () => {
      active = false;
      if (rerunTimer) clearTimeout(rerunTimer);
      unsubscribe();
    };
    // The query captures the values represented by the caller-supplied deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    error,
    updatedAt,
    isResolved: resolvedDependencyToken === dependencyToken,
  } as const;
}

type MigrationState = { success: boolean; error?: Error };

export function useMigrations(db: Database, migrations: MigrationBundle): MigrationState {
  const [state, setState] = useState<MigrationState>({ success: false });

  useEffect(() => {
    let active = true;
    setState({ success: false });
    migrateDatabase(db, migrations).then(
      () => {
        if (active) setState({ success: true });
      },
      (reason: unknown) => {
        if (active) {
          setState({
            success: false,
            error: reason instanceof Error ? reason : new Error(String(reason)),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [db, migrations]);

  return state;
}
