import { platform } from '@/platform';

import * as schema from './schema';

/**
 * The app's Drizzle handle, constructed through the platform's `SqliteDriver`
 * port so the asynchronous database executor lives in the adapter. Everything
 * goes through `db`; raw SQL
 * that Drizzle can't express (FTS5 `MATCH` + `snippet()`, streaming exports)
 * goes through `platform.database.rawQuery*` — the raw `sqlite` handle is no
 * longer exported.
 */
export const db = platform.database.drizzle(schema);

export type Database = typeof db;
