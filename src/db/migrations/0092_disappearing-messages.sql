ALTER TABLE conversations ADD COLUMN disappear_after_seconds integer;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN disappear_after_seconds integer;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN expires_at integer;
--> statement-breakpoint
CREATE INDEX idx_msg_expiry ON messages (account_pubkey, expires_at) WHERE expires_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE relay_outbox_jobs ADD COLUMN next_attempt_at integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP TRIGGER message_fts_ai;--> statement-breakpoint
DROP TRIGGER message_fts_au;--> statement-breakpoint
CREATE TRIGGER message_fts_ai AFTER INSERT ON messages
WHEN new.kind = 14 AND new.content <> '' AND new.deleted = 0 AND new.disappear_after_seconds IS NULL
BEGIN
  INSERT INTO message_fts (rowid, content, id, account_pubkey, conversation_key, created_at, order_at)
  VALUES (new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at, new.order_at);
END;--> statement-breakpoint
CREATE TRIGGER message_fts_au AFTER UPDATE ON messages
WHEN old.kind = 14 OR new.kind = 14
BEGIN
  DELETE FROM message_fts WHERE rowid = old.rowid;
  INSERT INTO message_fts (rowid, content, id, account_pubkey, conversation_key, created_at, order_at)
  SELECT new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at, new.order_at
  WHERE new.kind = 14 AND new.content <> '' AND new.deleted = 0 AND new.disappear_after_seconds IS NULL;
END;
