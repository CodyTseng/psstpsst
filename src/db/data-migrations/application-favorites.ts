import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { favoriteReference, parseFavoriteSnapshot, KIND_APP_FAVORITES, FAVORITES_D } from '@/services/explore/favorites-protocol';
import type { ExploreEntry } from '@/services/explore/model';

/** Preserve local edits and the last decrypted snapshot before dropping the legacy projection. */
export async function migrateApplicationFavorites(tx: Database) {
  const rows = await tx.values(sql`SELECT s.account_pubkey,s.reference,e.address,e.kind
    FROM legacy_explore_shortcuts s JOIN explore_entries e
    ON e.account_pubkey=s.account_pubkey AND e.source_id=s.source_id
    ORDER BY s.account_pubkey,s.position,s.source_id`) as unknown[][];
  const accounts = new Map<string, string[][]>();
  for (const [owner, reference, address, kind] of rows) {
    try {
      const tag = reference ? JSON.parse(String(reference)) as string[] : favoriteReference({ address: String(address),
        kind: String(kind) as ExploreEntry['kind'] });
      parseFavoriteSnapshot(JSON.stringify([tag]));
      const tags = accounts.get(String(owner)) ?? [];
      tags.push(tag); accounts.set(String(owner), tags);
    } catch { /* Malformed legacy references cannot become signed favorites. */ }
  }
  for (const [account, tags] of accounts) {
    const [state] = await tx.values(sql`SELECT dirty,event_id FROM private_list_sync_state
      WHERE account_pubkey=${account} AND kind=${KIND_APP_FAVORITES} AND d_tag=${FAVORITES_D}`) as unknown[][];
    if (state && !state[0] && state[1]) {
      await tx.run(sql`UPDATE private_list_sync_state SET snapshot=${JSON.stringify({ eventId: String(state[1]), tags })}
        WHERE account_pubkey=${account} AND kind=${KIND_APP_FAVORITES} AND d_tag=${FAVORITES_D}`);
    } else {
      await tx.run(sql`INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag,revision,dirty,draft)
        VALUES(${account},${KIND_APP_FAVORITES},${FAVORITES_D},1,1,${JSON.stringify(tags)})
        ON CONFLICT(account_pubkey,kind,d_tag) DO UPDATE SET draft=excluded.draft,dirty=1`);
    }
  }
  await tx.run(sql`UPDATE private_list_sync_state SET draft='[]' WHERE kind=${KIND_APP_FAVORITES}
    AND d_tag=${FAVORITES_D} AND dirty=1 AND draft IS NULL`);
  await tx.run(sql`DROP TABLE legacy_explore_shortcuts`);
}
