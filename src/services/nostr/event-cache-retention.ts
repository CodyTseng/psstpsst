import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db } from '@/db/client';
import { KIND_APP_FAVORITES, MY_APPS_D } from '@/services/explore/favorites-protocol';

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

const references = sql`SELECT json_extract(ref.value,'$[0]') AS type,json_extract(ref.value,'$[1]') AS reference
  FROM private_list_sync_state,
    json_each(CASE WHEN dirty=1 AND draft IS NOT NULL THEN draft ELSE COALESCE(json_extract(snapshot,'$.tags'),'[]') END) ref
  WHERE kind=${KIND_APP_FAVORITES} AND d_tag=${MY_APPS_D}`;
export const favoriteEventIds = sql`SELECT reference FROM (${references}) WHERE type='e'`;
export const favoriteCoordinates = sql`SELECT reference FROM (${references}) WHERE type='a'`;
