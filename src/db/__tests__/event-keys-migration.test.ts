import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { applicationTestDatabase } from '@/services/explore/testing/database';
import { migrateEventKeys } from '../data-migrations/event-keys';

function fixture() {
  const value = applicationTestDatabase();
  for (const name of ['0064_signer-access', '0065_authorization-destinations', '0066_signer-access-kind', '0067_application-relay-auth', '0068_signing-scope-key', '0069_browser-authorizations'])
    value.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/${name}.sql`, 'utf8'));
  return value;
}

it('merges encoded aliases without losing data, account scope, history or explicit denials', async () => {
  const { sqlite, db } = fixture();
  const key = `35130:${'a'.repeat(64)}:notes`;
  const address = naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'notes' });
  const alias = naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'notes', relays: ['wss://hint.example'] });
  const insert = sqlite.prepare('INSERT INTO napplet_data VALUES (?,?,?,?,?,?)');
  try {
    insert.run('account', address, 'storage', 'same', 'old', 7);
    insert.run('account', key, 'storage', 'same', 'current', 11);
    insert.run('other', address, 'storage', 'same', 'other-account', 17);
    insert.run('account', address, 'permissions', 'domains', '["shell","network"]', 30);
    insert.run('account', key, 'permissions', 'domains', '["shell"]', 16);
    insert.run('account', alias, 'permissions', 'denied-domains', '["storage"]', 25);
    insert.run('account', key, 'permissions', 'denied-domains', '["theme"]', 23);
    sqlite.prepare('INSERT INTO explore_history VALUES (?,?,?)').run('account', address, 100);
    sqlite.prepare('INSERT INTO explore_history VALUES (?,?,?)').run('account', key, 200);
    const rule = sqlite.prepare('INSERT INTO signing_authorizations(account_pubkey,source_id,kind,decision,created_at,updated_at) VALUES (?,?,1,?,1,10)');
    rule.run('account', address, 'deny'); rule.run('account', key, 'allow');
    await db.transaction(migrateEventKeys);
    expect(sqlite.prepare("SELECT app_key,value FROM napplet_data WHERE account_pubkey='account' AND bucket='storage'").get()).toEqual({ app_key: key, value: 'current' });
    expect(sqlite.prepare("SELECT value FROM napplet_data WHERE account_pubkey='other'").get()).toEqual({ value: 'other-account' });
    expect(sqlite.prepare("SELECT value FROM napplet_data_legacy WHERE bucket='storage'").get()).toEqual({ value: 'old' });
    const permissions = sqlite.prepare("SELECT key,value FROM napplet_data WHERE account_pubkey='account' AND bucket='permissions' ORDER BY key").all();
    expect(permissions).toEqual([{ key: 'denied-domains', value: '["storage","theme"]' }, { key: 'domains', value: '["shell"]' }]);
    expect(sqlite.prepare('SELECT source_id,last_used_at FROM explore_history').get()).toEqual({ source_id: key, last_used_at: 200 });
    expect(sqlite.prepare('SELECT source_id,decision FROM signing_authorizations').get()).toEqual({ source_id: key, decision: 'deny' });
    const usage = sqlite.prepare("SELECT bytes,count FROM napplet_usage WHERE account_pubkey='account' AND bucket='storage'").get();
    expect(usage).toEqual({ bytes: 11, count: 1 });
    await db.transaction(migrateEventKeys);
    expect(sqlite.prepare("SELECT count(*) AS count FROM napplet_data_legacy WHERE bucket='storage'").get()).toEqual({ count: 1 });
  } finally { sqlite.close(); }
});

it('maps verified event pointers to coordinates and removes immutable kind prefixes', async () => {
  const { sqlite, db } = fixture();
  const event = finalizeEvent({ kind: 35130, created_at: 1, tags: [['d', 'notes']], content: '' }, generateSecretKey());
  const coordinate = `35130:${event.pubkey}:notes`, immutable = 'b'.repeat(64);
  try {
    sqlite.prepare('INSERT INTO cached_events(id,event,fetched_at) VALUES (?,?,1)').run(event.id, JSON.stringify(event));
    const insert = sqlite.prepare('INSERT INTO napplet_data VALUES (?,?,?,?,?,?)');
    insert.run('account', neventEncode({ id: event.id }), 'storage', 'one', '1', 4);
    insert.run('account', `5129:${immutable}`, 'storage', 'two', '2', 4);
    insert.run('account', '__host__', 'defaults', 'handler', `5129:${immutable}`, 80);
    await db.transaction(migrateEventKeys);
    expect(sqlite.prepare("SELECT app_key FROM napplet_data WHERE bucket='storage' ORDER BY key").all()).toEqual([{ app_key: coordinate }, { app_key: immutable }]);
    expect(sqlite.prepare("SELECT value FROM napplet_data WHERE bucket='defaults'").get()).toEqual({ value: immutable });
  } finally { sqlite.close(); }
});
