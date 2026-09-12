-- Scope messages (and their attachment / participant indexes) to the owning
-- account. The old schema keyed `messages` by the rumor `id` alone, so two
-- accounts on the same device that DM each other shared one row per rumor —
-- wiping one account's messages would take the other's with it. Each account now
-- keeps its own copy under `(account_pubkey, id)`.
--
-- Pre-launch: no data is preserved (see ROADMAP / project notes), so the tables
-- are dropped and recreated rather than migrated in place. Children (and the FTS
-- triggers on `messages`) are dropped first so the parent drop is clean.
DROP TRIGGER IF EXISTS `message_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `message_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `message_fts_au`;--> statement-breakpoint
DROP TABLE IF EXISTS `message_fts`;--> statement-breakpoint
DROP TABLE IF EXISTS `message_attachments`;--> statement-breakpoint
DROP TABLE IF EXISTS `message_participants`;--> statement-breakpoint
DROP TABLE IF EXISTS `messages`;--> statement-breakpoint
CREATE TABLE `messages` (
	`account_pubkey` text NOT NULL,
	`id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`participants_key` text NOT NULL,
	`group_id` text,
	`sender_pubkey` text NOT NULL,
	`kind` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`reply_to_id` text,
	`subject` text,
	`tags` text NOT NULL,
	`rumor` text NOT NULL,
	`source_relays` text,
	PRIMARY KEY(`account_pubkey`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_msg_conv_time` ON `messages` (`account_pubkey`,`conversation_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_msg_participants` ON `messages` (`account_pubkey`,`participants_key`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`url` text NOT NULL,
	`ox` text,
	`mime` text,
	`size` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `message_id`),
	FOREIGN KEY (`account_pubkey`,`message_id`) REFERENCES `messages`(`account_pubkey`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_att_conv_time` ON `message_attachments` (`account_pubkey`,`conversation_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_att_ox` ON `message_attachments` (`ox`);--> statement-breakpoint
CREATE INDEX `idx_att_url` ON `message_attachments` (`url`);--> statement-breakpoint
CREATE TABLE `message_participants` (
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`pubkey` text NOT NULL,
	PRIMARY KEY(`account_pubkey`, `message_id`, `pubkey`),
	FOREIGN KEY (`account_pubkey`,`message_id`) REFERENCES `messages`(`account_pubkey`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mp_pubkey` ON `message_participants` (`account_pubkey`,`pubkey`);--> statement-breakpoint
CREATE VIRTUAL TABLE `message_fts` USING fts5(
	content,
	id UNINDEXED,
	account_pubkey UNINDEXED,
	conversation_key UNINDEXED,
	created_at UNINDEXED,
	tokenize = 'trigram'
);
--> statement-breakpoint
INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at)
SELECT rowid, content, id, account_pubkey, conversation_key, created_at
FROM `messages` WHERE kind = 14 AND content <> '';
--> statement-breakpoint
CREATE TRIGGER `message_fts_ai` AFTER INSERT ON `messages`
WHEN new.kind = 14 AND new.content <> ''
BEGIN
	INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at)
	VALUES (new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at);
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
	INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at)
	SELECT new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at
	WHERE new.kind = 14 AND new.content <> '';
END;
