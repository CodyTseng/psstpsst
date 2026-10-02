import Database from 'better-sqlite3';

import migrations from '../migrations/migrations';

describe('observed peer encryption key migration', () => {
  test('backfills each public announcement once per peer identity', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE encryption_key_announcements (
        pubkey text PRIMARY KEY NOT NULL,
        encryption_pubkey text NOT NULL,
        event_id text NOT NULL,
        event_created_at integer NOT NULL,
        fetched_at integer NOT NULL
      );
      INSERT INTO encryption_key_announcements (
        pubkey, encryption_pubkey, event_id, event_created_at, fetched_at
      ) VALUES ('peer', 'announcement-key', 'announcement-id', 123, 456);
    `);
    sqlite.exec(migrations.migrations.m0052);
    const insert = sqlite.prepare(`
      INSERT INTO observed_peer_encryption_keys (
        peer_pubkey, encryption_pubkey,
        source, evidence_id, evidence_created_at, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    expect(
      sqlite.prepare(`
        SELECT peer_pubkey, encryption_pubkey, source,
               evidence_id, evidence_created_at, observed_at
        FROM observed_peer_encryption_keys
      `).all(),
    ).toEqual([
      {
        peer_pubkey: 'peer',
        encryption_pubkey: 'announcement-key',
        source: 'kind-10044',
        evidence_id: 'announcement-id',
        evidence_created_at: 123_000,
        observed_at: 456,
      },
    ]);
    expect(() => insert.run('peer', 'other', 'seal', 'message-c', 300, 3)).toThrow();

    sqlite.exec(migrations.migrations.m0053);
    expect(
      sqlite.prepare(`
        SELECT announcement_checked_at
        FROM observed_peer_encryption_keys
        WHERE peer_pubkey = 'peer'
      `).get(),
    ).toEqual({ announcement_checked_at: 456 });
    sqlite.close();
  });
});
