import { sql } from 'drizzle-orm';
import type { Database } from '../client';

export async function ensureRoutingSettingsEditsTable(tx: Database) {
  await tx.run(sql`CREATE TABLE IF NOT EXISTS routing_settings_edits (
    account_pubkey TEXT NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
    kind INTEGER NOT NULL,
    urls TEXT NOT NULL,
    revision INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    PRIMARY KEY (account_pubkey, kind)
  )`);
  await tx.run(sql`CREATE INDEX IF NOT EXISTS idx_routing_settings_edits_due
    ON routing_settings_edits(account_pubkey, next_attempt_at)`);
}

/** Restore columns skipped by development databases with overlapping migration timestamps. */
export async function repairRelaySettings(tx: Database) {
  await ensureRoutingSettingsEditsTable(tx);
  const outbox = await tx.values(sql`SELECT name FROM pragma_table_info('configuration_outbox')`);
  const outboxColumns = new Set(outbox.map(([name]) => name));
  if (!outboxColumns.has('previous_write_relays')) {
    await tx.run(sql`ALTER TABLE configuration_outbox ADD COLUMN previous_write_relays TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!outboxColumns.has('rejected_relays')) {
    await tx.run(sql`ALTER TABLE configuration_outbox ADD COLUMN rejected_relays TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!outboxColumns.has('retry_not_before')) {
    await tx.run(sql`ALTER TABLE configuration_outbox ADD COLUMN retry_not_before INTEGER NOT NULL DEFAULT 0`);
  }
  if (!outboxColumns.has('stopped')) {
    await tx.run(sql`ALTER TABLE configuration_outbox ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0`);
    await tx.run(sql`DROP INDEX IF EXISTS idx_configuration_outbox_due`);
    await tx.run(sql`CREATE INDEX idx_configuration_outbox_due ON configuration_outbox(account_pubkey, stopped, next_attempt_at)`);
  }

  const targets = await tx.values(sql`SELECT name FROM pragma_table_info('relay_outbox_job_targets')`);
  const targetColumns = new Set(targets.map(([name]) => name));
  if (!targetColumns.has('next_attempt_at')) {
    await tx.run(sql`ALTER TABLE relay_outbox_job_targets ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0`);
  }
  if (!targetColumns.has('rate_limit_attempts')) {
    await tx.run(sql`ALTER TABLE relay_outbox_job_targets ADD COLUMN rate_limit_attempts INTEGER NOT NULL DEFAULT 0`);
  }

  const editTime = await tx.values(sql`SELECT name FROM pragma_table_info('routing_settings_edits') WHERE name = 'edited_at'`);
  if (editTime.length === 0) {
    await tx.run(sql`ALTER TABLE routing_settings_edits ADD COLUMN edited_at INTEGER NOT NULL DEFAULT 0`);
    await tx.run(sql`UPDATE routing_settings_edits
      SET edited_at = MAX(0, (next_attempt_at - CASE attempts
        WHEN 0 THEN 2000 WHEN 1 THEN 1000 WHEN 2 THEN 2000 WHEN 3 THEN 5000
        WHEN 4 THEN 10000 WHEN 5 THEN 30000 ELSE 60000 END) / 1000)`);
  }
}
