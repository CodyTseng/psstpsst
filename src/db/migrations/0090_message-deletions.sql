ALTER TABLE messages ADD COLUMN deleted integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE message_deletions (
  account_pubkey text NOT NULL,
  id text NOT NULL,
  order_at integer NOT NULL,
  rumor text NOT NULL,
  PRIMARY KEY (account_pubkey, id)
);--> statement-breakpoint
DROP TRIGGER message_fts_ai;--> statement-breakpoint
DROP TRIGGER message_fts_au;--> statement-breakpoint
CREATE TRIGGER message_fts_ai AFTER INSERT ON messages
WHEN new.kind = 14 AND new.content <> '' AND new.deleted = 0
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
  WHERE new.kind = 14 AND new.content <> '' AND new.deleted = 0;
END;
