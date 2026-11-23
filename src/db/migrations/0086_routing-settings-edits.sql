CREATE TABLE routing_settings_edits (
  account_pubkey TEXT NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  kind INTEGER NOT NULL,
  urls TEXT NOT NULL,
  revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  PRIMARY KEY (account_pubkey, kind)
);
--> statement-breakpoint
CREATE INDEX idx_routing_settings_edits_due ON routing_settings_edits(account_pubkey, next_attempt_at);
--> statement-breakpoint
ALTER TABLE configuration_outbox ADD COLUMN previous_write_relays TEXT NOT NULL DEFAULT '[]';
