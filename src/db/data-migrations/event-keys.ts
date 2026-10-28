import { sql } from 'drizzle-orm';
import { verifyEvent, type Event } from 'nostr-tools';
import type { Database } from '../client';
import { eventKey, normalizeEventKey } from '@/lib/nostr/event-key';

const namespaces = [
  ['napplet_installations', 'app_key'], ['napplet_data', 'app_key'], ['napplet_data_legacy', 'app_key'],
  ['napplet_usage', 'app_key'], ['explore_entries', 'source_id'], ['explore_history', 'source_id'],
  ['signing_authorizations', 'source_id'], ['signing_activity', 'source_id'], ['browser_authorizations', 'source_id'],
  ['local_applications', 'installer'],
] as const;
const quote = (name: string) => `"${name}"`;

/** Atomic identity upgrade; keyset reads bound JS work independently of event-cache size. */
export async function migrateEventKeys(tx: Database): Promise<void> {
  const tables = new Set((await tx.values(sql`SELECT name FROM sqlite_master WHERE type='table'`) as string[][]).map(row => row[0]));
  const present = namespaces.filter(([table]) => tables.has(table));
  await tx.run(sql.raw('CREATE TEMP TABLE event_key_aliases(old_key TEXT PRIMARY KEY,event_key TEXT NOT NULL)'));
  const sources = [...present.map(([table, column]) => `SELECT ${quote(column)} AS value FROM ${quote(table)}`),
    ...(tables.has('napplet_data') ? ["SELECT value FROM napplet_data WHERE bucket='defaults'"] : [])].join(' UNION ');
  await tx.run(sql.raw('CREATE TEMP TABLE event_key_inputs(value TEXT PRIMARY KEY)'));
  if (sources) await tx.run(sql.raw(`INSERT OR IGNORE INTO event_key_inputs ${sources}`));
  let cursor = '';
  while (true) {
    const rows = await tx.values(sql`SELECT value FROM event_key_inputs WHERE value>${cursor} ORDER BY value LIMIT 128`) as string[][];
    if (!rows.length) break;
    for (const [index, [oldKey]] of rows.entries()) {
      if (index % 8 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      cursor = oldKey;
      let key: string;
      try { key = normalizeEventKey(oldKey); } catch { continue; }
      if (/^[a-f0-9]{64}$/.test(key) && tables.has('cached_events')) {
        const [cached] = await tx.values(sql`SELECT event FROM cached_events WHERE id=${key}`) as string[][];
        if (cached && cached[0].length <= 256 * 1024) {
          try {
            const event = JSON.parse(cached[0]) as Event;
            if (event.id === key && [5129, 15128, 15129, 35128, 35129, 35130].includes(event.kind) && verifyEvent(event)) key = eventKey(event);
          } catch { /* An unverified cache entry cannot change an authorization identity. */ }
        }
      }
      if (key !== oldKey) await tx.run(sql`INSERT INTO event_key_aliases VALUES(${oldKey},${key})`);
    }
  }
  await tx.run(sql.raw('DROP TABLE event_key_inputs'));

  for (const [table, column] of present) {
    if (table === 'napplet_usage') continue;
    const columns = await tx.values(sql.raw(`PRAGMA table_info(${quote(table)})`)) as unknown[][];
    const names = columns.map(row => String(row[1]));
    const primary = columns.filter(row => Number(row[5]) > 0).sort((a, b) => Number(a[5]) - Number(b[5])).map(row => String(row[1]));
    const unique = table === 'signing_authorizations'
      ? ['account_pubkey', 'source_id', 'operation', 'kind', 'scope_key', 'recipient', 'destinations'] : primary;
    const canonical = `COALESCE(a.event_key,t.${quote(column)})`;
    const projection = names.map(name => name === column ? `${canonical} AS ${quote(name)}` : `t.${quote(name)}`).join(',');
    const partition = unique.map(name => name === column ? canonical : `t.${quote(name)}`).join(',');
    const order = table === 'explore_history' ? 't.last_used_at DESC'
      : table === 'napplet_installations' ? "COALESCE(json_extract(CASE WHEN json_valid(t.manifest) THEN t.manifest ELSE '{}' END,'$.created_at'),0) DESC,t.rowid DESC"
      : table === 'signing_authorizations' || table === 'browser_authorizations' ? "t.updated_at DESC,(t.decision='deny') DESC"
        : `(${canonical}=t.${quote(column)}) DESC,t.rowid DESC`;
    await tx.run(sql.raw(`CREATE TEMP TABLE event_key_rows AS SELECT ${projection},t.${quote(column)} AS old_key,
      row_number() OVER(PARTITION BY ${partition} ORDER BY ${order}) AS preference
      FROM ${quote(table)} t LEFT JOIN event_key_aliases a ON a.old_key=t.${quote(column)}`));
    if (table === 'napplet_data' && tables.has('napplet_data_legacy')) {
      // Preserve conflicting values outside the active namespace for inspection/recovery.
      await tx.run(sql.raw(`INSERT OR IGNORE INTO napplet_data_legacy(account_pubkey,app_key,artifact_hash,bucket,key,value,bytes)
        SELECT account_pubkey,app_key,'event-key:'||old_key,bucket,key,value,bytes FROM event_key_rows WHERE preference>1`));
    }
    if (table === 'napplet_data_legacy') await tx.run(sql.raw("UPDATE event_key_rows SET artifact_hash='event-key:'||old_key||':'||artifact_hash,preference=1 WHERE preference>1"));
    if (table === 'napplet_installations') await tx.run(sql.raw(`UPDATE event_key_rows AS r SET
      last_used_at=(SELECT max(s.last_used_at) FROM event_key_rows s WHERE s.account_pubkey=r.account_pubkey AND s.app_key=r.app_key),
      desktop_position=(SELECT min(s.desktop_position) FROM event_key_rows s WHERE s.account_pubkey=r.account_pubkey AND s.app_key=r.app_key) WHERE r.preference=1`));
    await tx.run(sql.raw(`DELETE FROM ${quote(table)}`));
    await tx.run(sql.raw(`INSERT INTO ${quote(table)}(${names.map(quote).join(',')})
      SELECT ${names.map(quote).join(',')} FROM event_key_rows WHERE preference=1`));
    if (table === 'napplet_data') {
      // Conflicting grants intersect; explicit optional denials combine across old aliases.
      await tx.run(sql.raw(`UPDATE napplet_data AS d SET value=(SELECT json_group_array(domain) FROM (
        SELECT j.value AS domain FROM event_key_rows r,json_each(CASE WHEN json_valid(r.value) THEN r.value ELSE '[]' END) j
        WHERE r.account_pubkey=d.account_pubkey AND r.app_key=d.app_key AND r.bucket=d.bucket AND r.key=d.key AND j.type='text'
        GROUP BY j.value HAVING d.key='denied-domains' OR count(DISTINCT r.old_key)=(
          SELECT count(*) FROM event_key_rows s WHERE s.account_pubkey=d.account_pubkey AND s.app_key=d.app_key AND s.bucket=d.bucket AND s.key=d.key)
        ORDER BY domain)) WHERE d.bucket='permissions' AND d.key IN ('domains','denied-domains')`));
    }
    await tx.run(sql.raw('DROP TABLE event_key_rows'));
  }
  if (tables.has('napplet_data')) {
    await tx.run(sql.raw(`UPDATE napplet_data SET value=(SELECT event_key FROM event_key_aliases WHERE old_key=napplet_data.value)
      WHERE bucket='defaults' AND value IN (SELECT old_key FROM event_key_aliases)`));
    await tx.run(sql.raw('UPDATE napplet_data SET bytes=length(CAST(key AS BLOB))+length(CAST(value AS BLOB))'));
    await tx.run(sql.raw('DELETE FROM napplet_usage'));
    await tx.run(sql.raw('INSERT INTO napplet_usage SELECT account_pubkey,app_key,bucket,sum(bytes),count(*) FROM napplet_data GROUP BY account_pubkey,app_key,bucket'));
  }
  if (tables.has('local_applications')) await tx.run(sql.raw("UPDATE local_applications SET entry=json_set(entry,'$.local.installer',installer) WHERE json_valid(entry)"));
  await tx.run(sql.raw('DROP TABLE event_key_aliases'));
}
