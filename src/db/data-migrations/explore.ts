import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { signingSourceFromLegacyKey } from '@/services/signing/source';
/** Preserve the existing desktop and recency in the same migration transaction. */
export async function migrateExplore(tx: Database) {
  let offset = 0;
  while (true) {
    const rows = await tx.values(sql `SELECT account_pubkey,app_key,manifest,desktop_position,last_used_at FROM napplet_installations ORDER BY account_pubkey,app_key LIMIT 128 OFFSET ${offset}`) as unknown[][];
    if (!rows.length)
      break;
    for (const [account, key, manifest, position, lastUsed] of rows) {
      let source: string;
      try {
        source = signingSourceFromLegacyKey(String(key));
      }
      catch {
        continue;
      }
      await tx.run(sql `INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind,manifest) VALUES(${String(account)},${source},${source},${source},'napplet',${String(manifest)})`);
      if (position !== null)
        await tx.run(sql `INSERT INTO explore_shortcuts(account_pubkey,source_id,position) VALUES(${String(account)},${source},${Number(position)})`);
      if (lastUsed !== null)
        await tx.run(sql `INSERT INTO explore_history VALUES(${String(account)},${source},${Number(lastUsed)})`);
    }
    offset += rows.length;
  }
}
