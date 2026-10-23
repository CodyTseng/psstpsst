import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db } from '@/db/client';

/** Bound unpinned public cache data by both count and bytes; account favorites stay available offline. */
export async function pruneEventCache(table: SQLWrapper, key: SQLWrapper, event: SQLWrapper, fetchedAt: SQLWrapper, unpinned: SQL) {
  await db.run(sql`DELETE FROM ${table} WHERE ${key} IN (
    SELECT cache_key FROM (
      SELECT ${key} AS cache_key,ROW_NUMBER() OVER (ORDER BY ${fetchedAt} DESC,${key}) AS position,
        SUM(LENGTH(CAST(${event} AS BLOB))) OVER (ORDER BY ${fetchedAt} DESC,${key}) AS bytes
      FROM ${table} WHERE ${unpinned}
    ) WHERE position>2048 OR bytes>33554432
  )`);
}

export const favoriteEventIds = sql`SELECT reference FROM application_favorite_references WHERE type='e'`;
export const favoriteCoordinates = sql`SELECT reference FROM application_favorite_references WHERE type='a'`;
