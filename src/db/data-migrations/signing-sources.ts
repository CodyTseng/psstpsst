import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { signingSourceFromLegacyKey } from '@/services/signing/source';

/** Runs inside migration 61's transaction before any new authorization can be read. */
export async function migrateSigningSources(tx: Database): Promise<void> {
  for (const table of ['signing_authorizations', 'signing_activity']) {
    let cursor = 0;
    while (true) {
      const rows = await tx.values(sql.raw(`SELECT id,source_id FROM ${table} WHERE id>${cursor} ORDER BY id LIMIT 128`)) as unknown[][];
      if (!rows.length) break;
      for (const [id, legacy] of rows) {
        cursor = Number(id);
        let source: string;
        try { source = signingSourceFromLegacyKey(String(legacy)); }
        catch {
          // Unverifiable legacy identities stay in the backup, never as active grants.
          await tx.run(sql`DELETE FROM ${sql.identifier(table)} WHERE id=${cursor}`);
          continue;
        }
        await tx.run(sql`UPDATE ${sql.identifier(table)} SET source_id=${source} WHERE id=${cursor}`);
      }
    }
  }
}
