ALTER TABLE relay_outbox_job_targets ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE relay_outbox_job_targets ADD COLUMN rate_limit_attempts INTEGER NOT NULL DEFAULT 0;
