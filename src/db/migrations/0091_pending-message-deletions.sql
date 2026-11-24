ALTER TABLE message_deletions ADD COLUMN pending_target_id text;
--> statement-breakpoint
CREATE INDEX message_deletions_pending_target_idx
  ON message_deletions (account_pubkey, pending_target_id)
  WHERE pending_target_id IS NOT NULL;
