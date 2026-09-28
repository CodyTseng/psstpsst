-- Match message chronology to Nostr's replaceable-event tie-break: for equal
-- order_at values, the lexicographically smaller event ID is newer. These
-- directions support both newest-first scans and their exact reverse.
DROP INDEX `idx_msg_conv_time`;--> statement-breakpoint
CREATE INDEX `idx_msg_conv_time` ON `messages` (
	`account_pubkey`,
	`conversation_key`,
	`order_at` DESC,
	`id` ASC
);--> statement-breakpoint

DROP INDEX `idx_msg_media_gallery_time`;--> statement-breakpoint
CREATE INDEX `idx_msg_media_gallery_time` ON `message_media` (
	`account_pubkey`,
	`conversation_key`,
	`gallery`,
	`order_at` DESC,
	`message_id` ASC,
	`url` DESC
);--> statement-breakpoint

-- Existing conversation heads were selected with the former larger-ID-wins
-- tie-break. Repoint them without loading conversation histories into JS.
UPDATE `conversations`
SET (`last_message_id`, `last_message_order_at`, `last_message_at`) = (
	SELECT `messages`.`id`, `messages`.`order_at`, `messages`.`created_at`
	FROM `messages`
	WHERE `messages`.`account_pubkey` = `conversations`.`account_pubkey`
		AND `messages`.`conversation_key` = `conversations`.`conversation_key`
		AND `messages`.`kind` IN (14, 15)
	ORDER BY `messages`.`order_at` DESC, `messages`.`id` ASC
	LIMIT 1
)
WHERE EXISTS (
	SELECT 1
	FROM `messages`
	WHERE `messages`.`account_pubkey` = `conversations`.`account_pubkey`
		AND `messages`.`conversation_key` = `conversations`.`conversation_key`
		AND `messages`.`kind` IN (14, 15)
);
