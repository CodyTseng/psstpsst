import { readFileSync } from 'node:fs';
import { naddrEncode } from 'nostr-tools/nip19';
import { applicationTestDatabase } from '@/services/explore/testing/database';
import { migrateApplicationFavorites } from '../data-migrations/application-favorites';

it('keeps current application-cache schemas intact when the repair migration runs', () => {
  const fixture = applicationTestDatabase();
  try {
    const before = fixture.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('application_favorite_references','replaceable_cache_freshness') ORDER BY name").all();
    fixture.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0074_application-cache-retention.sql`, 'utf8'));
    expect(fixture.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('application_favorite_references','replaceable_cache_freshness') ORDER BY name").all()).toEqual(before);
  } finally { fixture.sqlite.close(); }
});

it('preserves ordered unsynced favorites as a revision draft before removing the projection', async () => {
  const fixture = applicationTestDatabase(true);
  try {
    const coordinate = naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'notes' });
    fixture.sqlite.prepare('INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind) VALUES (?,?,?,?,?)')
      .run('account', coordinate, coordinate, 'Notes', 'napp');
    fixture.sqlite.prepare('INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind) VALUES (?,?,?,?,?)')
      .run('account', 'https://example.com/', 'https://example.com/', 'Website', 'website');
    const insert = fixture.sqlite.prepare('INSERT INTO explore_shortcuts(account_pubkey,source_id,position) VALUES (?,?,?)');
    insert.run('account', 'https://example.com/', 0); insert.run('account', coordinate, 1);
    fixture.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0071_event-backed-applications.sql`, 'utf8'));
    await fixture.db.transaction(async tx => { await migrateApplicationFavorites(tx); });
    const state = fixture.sqlite.prepare('SELECT dirty,draft FROM private_list_sync_state').get() as { dirty: number; draft: string };
    expect(state.dirty).toBe(1);
    expect(JSON.parse(state.draft)).toEqual([['r', 'https://example.com/'], ['a', `35130:${'a'.repeat(64)}:notes`]]);
    expect(fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('explore_shortcuts','legacy_explore_shortcuts')").all()).toEqual([]);
  } finally { fixture.sqlite.close(); }
});

it('retains synced snapshots as derived cache and preserves an unsynced empty collection', async () => {
  const fixture = applicationTestDatabase(true);
  try {
    fixture.sqlite.exec(`INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag,revision,dirty,event_id)
      VALUES ('account',30267,'psstpsst-favorites',9,0,'signed'),('other',30267,'psstpsst-favorites',3,1,'older');
      INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind) VALUES ('account','https://example.com/','https://example.com/','Website','website');
      INSERT INTO explore_shortcuts(account_pubkey,source_id,position) VALUES ('account','https://example.com/',0);`);
    fixture.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0071_event-backed-applications.sql`, 'utf8'));
    await fixture.db.transaction(async tx => { await migrateApplicationFavorites(tx); });
    const saved = fixture.sqlite.prepare("SELECT revision,dirty,draft,snapshot FROM private_list_sync_state WHERE account_pubkey='account'").get() as
      { revision: number; dirty: number; draft: string | null; snapshot: string };
    expect(saved).toMatchObject({ revision: 9, dirty: 0, draft: null });
    expect(JSON.parse(saved.snapshot)).toEqual({ eventId: 'signed', tags: [['r', 'https://example.com/']] });
    expect(fixture.sqlite.prepare("SELECT revision,dirty,draft FROM private_list_sync_state WHERE account_pubkey='other'").get())
      .toEqual({ revision: 3, dirty: 1, draft: '[]' });
  } finally { fixture.sqlite.close(); }
});
