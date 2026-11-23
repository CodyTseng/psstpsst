ALTER TABLE configuration_outbox ADD COLUMN rejected_relays TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE configuration_outbox ADD COLUMN retry_not_before INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE configuration_outbox ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP INDEX idx_configuration_outbox_due;
--> statement-breakpoint
CREATE INDEX idx_configuration_outbox_due ON configuration_outbox(account_pubkey, stopped, next_attempt_at);
