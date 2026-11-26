import { applicationTestDatabase } from '@/services/explore/testing/database';
import migrations from '../migrations/migrations';
import { migrateDatabase } from '../use-live-query';

jest.mock('@/platform', () => ({ platform: {} }));

it.each(['early', 'late', 'current'])('preserves pending work when upgrading a %s Relay schema', async schema => {
  const current = schema === 'current';
  const { sqlite, db } = applicationTestDatabase();
  try {
    sqlite.exec(`
      CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);
      CREATE TABLE configuration_outbox (account_pubkey TEXT, next_attempt_at INTEGER, attempts INTEGER);
      CREATE INDEX idx_configuration_outbox_due ON configuration_outbox(account_pubkey, next_attempt_at);
      CREATE TABLE relay_outbox_job_targets (relay_url TEXT);
      INSERT INTO configuration_outbox VALUES ('account', 12000, 2);
      INSERT INTO relay_outbox_job_targets VALUES ('wss://relay.example');
    `);
    const record = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)");
    if (schema === 'early') {
      record.run(migrations.journal.entries[88].when);
    } else {
      record.run(migrations.journal.entries[89].when);
      record.run(migrations.journal.entries[94].when);
    }
    if (current) {
      for (const source of [migrations.migrations.m0086, migrations.migrations.m0087,
        migrations.migrations.m0088, migrations.migrations.m0089]) sqlite.exec(source);
      sqlite.exec(`
        UPDATE configuration_outbox SET stopped=1, retry_not_before=20000;
        UPDATE relay_outbox_job_targets SET rate_limit_attempts=3;
        INSERT INTO routing_settings_edits (account_pubkey, kind, urls, revision, next_attempt_at, edited_at)
        VALUES ('account', 10050, '[]', 2, 14000, 12);
      `);
    }

    // The fixture only includes the tables touched by the Relay migrations.
    const bundle = {
      ...migrations,
      journal: { entries: migrations.journal.entries.filter(entry => entry.idx === 89 || entry.idx === 95) },
    };
    await migrateDatabase(db, bundle);
    await migrateDatabase(db, bundle);

    expect(sqlite.prepare('SELECT * FROM configuration_outbox').get()).toMatchObject({
      account_pubkey: 'account', attempts: 2, next_attempt_at: 12000,
      previous_write_relays: '[]', rejected_relays: '[]',
      retry_not_before: current ? 20000 : 0, stopped: current ? 1 : 0,
    });
    expect(sqlite.prepare('SELECT * FROM relay_outbox_job_targets').get()).toMatchObject({
      relay_url: 'wss://relay.example', next_attempt_at: 0, rate_limit_attempts: current ? 3 : 0,
    });
    expect(sqlite.prepare('SELECT name FROM pragma_index_info(\'idx_configuration_outbox_due\')').all()
      .map(row => row.name)).toEqual(['account_pubkey', 'stopped', 'next_attempt_at']);
    expect(sqlite.prepare('SELECT kind, edited_at FROM routing_settings_edits').all())
      .toEqual(current ? [{ kind: 10050, edited_at: 12 }] : []);
    for (const entry of bundle.journal.entries) {
      expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations WHERE created_at = ?')
        .get(entry.when)).toEqual({ count: 1 });
    }
  } finally {
    sqlite.close();
  }
});
