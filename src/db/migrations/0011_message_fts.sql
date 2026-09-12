CREATE VIRTUAL TABLE `message_fts` USING fts5(
	content,
	id UNINDEXED,
	conversation_key UNINDEXED,
	created_at UNINDEXED,
	tokenize = 'trigram'
);
--> statement-breakpoint
INSERT INTO `message_fts` (rowid, content, id, conversation_key, created_at)
SELECT rowid, content, id, conversation_key, created_at
FROM `messages` WHERE kind = 14 AND content <> '';
--> statement-breakpoint
CREATE TRIGGER `message_fts_ai` AFTER INSERT ON `messages`
WHEN new.kind = 14 AND new.content <> ''
BEGIN
	INSERT INTO `message_fts` (rowid, content, id, conversation_key, created_at)
	VALUES (new.rowid, new.content, new.id, new.conversation_key, new.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER `message_fts_ad` AFTER DELETE ON `messages`
WHEN old.kind = 14
BEGIN
	DELETE FROM `message_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `message_fts_au` AFTER UPDATE ON `messages`
WHEN old.kind = 14 OR new.kind = 14
BEGIN
	DELETE FROM `message_fts` WHERE rowid = old.rowid;
	INSERT INTO `message_fts` (rowid, content, id, conversation_key, created_at)
	SELECT new.rowid, new.content, new.id, new.conversation_key, new.created_at
	WHERE new.kind = 14 AND new.content <> '';
END;
