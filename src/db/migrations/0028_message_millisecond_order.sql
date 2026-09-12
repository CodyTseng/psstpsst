-- Add an authenticated millisecond ordering key. Legacy rows fall back to
-- the start of their Nostr `created_at` second and continue to tie-break by id.
ALTER TABLE `messages` ADD COLUMN `order_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `messages` SET `order_at` = `created_at` * 1000;--> statement-breakpoint
DROP INDEX `idx_msg_conv_time`;--> statement-breakpoint
CREATE INDEX `idx_msg_conv_time` ON `messages` (`account_pubkey`,`conversation_key`,`order_at`,`id`);--> statement-breakpoint

ALTER TABLE `message_attachments` ADD COLUMN `order_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `message_attachments` SET `order_at` = `created_at` * 1000;--> statement-breakpoint
DROP INDEX `idx_att_conv_time`;--> statement-breakpoint
CREATE INDEX `idx_att_conv_time` ON `message_attachments` (`account_pubkey`,`conversation_key`,`order_at`,`message_id`);--> statement-breakpoint

ALTER TABLE `conversations` ADD COLUMN `last_message_order_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `last_read_order_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `deleted_order_at` integer;--> statement-breakpoint
UPDATE `conversations`
SET `last_message_order_at` = COALESCE(
  (SELECT `order_at` FROM `messages`
   WHERE `messages`.`account_pubkey` = `conversations`.`account_pubkey`
     AND `messages`.`id` = `conversations`.`last_message_id`),
  `last_message_at` * 1000
),
`last_read_order_at` = CASE WHEN `last_read_at` IS NULL THEN NULL ELSE COALESCE(
  (SELECT `order_at` FROM `messages`
   WHERE `messages`.`account_pubkey` = `conversations`.`account_pubkey`
     AND `messages`.`id` = `conversations`.`last_read_message_id`),
  `last_read_at` * 1000
) END;--> statement-breakpoint
UPDATE `conversations` SET `deleted_order_at` = `deleted_at` * 1000
WHERE `deleted_at` IS NOT NULL;--> statement-breakpoint
DROP INDEX `idx_conv_last_msg`;--> statement-breakpoint
CREATE INDEX `idx_conv_last_msg` ON `conversations` (`account_pubkey`,`last_message_order_at`);--> statement-breakpoint

-- FTS stores the ordering columns as unindexed metadata for keyset pagination.
DROP TRIGGER IF EXISTS `message_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `message_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `message_fts_au`;--> statement-breakpoint
DROP TABLE IF EXISTS `message_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `message_fts` USING fts5(
	content,
	id UNINDEXED,
	account_pubkey UNINDEXED,
	conversation_key UNINDEXED,
	created_at UNINDEXED,
	order_at UNINDEXED,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at, order_at)
SELECT rowid, content, id, account_pubkey, conversation_key, created_at, order_at
FROM `messages` WHERE kind = 14 AND content <> '';--> statement-breakpoint
CREATE TRIGGER `message_fts_ai` AFTER INSERT ON `messages`
WHEN new.kind = 14 AND new.content <> ''
BEGIN
	INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at, order_at)
	VALUES (new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at, new.order_at);
END;--> statement-breakpoint
CREATE TRIGGER `message_fts_ad` AFTER DELETE ON `messages`
WHEN old.kind = 14
BEGIN
	DELETE FROM `message_fts` WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE TRIGGER `message_fts_au` AFTER UPDATE ON `messages`
WHEN old.kind = 14 OR new.kind = 14
BEGIN
	DELETE FROM `message_fts` WHERE rowid = old.rowid;
	INSERT INTO `message_fts` (rowid, content, id, account_pubkey, conversation_key, created_at, order_at)
	SELECT new.rowid, new.content, new.id, new.account_pubkey, new.conversation_key, new.created_at, new.order_at
	WHERE new.kind = 14 AND new.content <> '';
END;
