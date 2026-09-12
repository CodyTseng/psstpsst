CREATE TABLE `__new_message_attachments` (
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`url` text NOT NULL,
	`ox` text,
	`mime` text,
	`size` integer,
	`created_at` integer NOT NULL,
	`order_at` integer NOT NULL,
	`downloaded_at` integer,
	PRIMARY KEY(`account_pubkey`, `message_id`, `url`),
	FOREIGN KEY (`account_pubkey`,`message_id`) REFERENCES `messages`(`account_pubkey`,`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_message_attachments`("account_pubkey", "message_id", "conversation_key", "url", "ox", "mime", "size", "created_at", "order_at", "downloaded_at") SELECT "account_pubkey", "message_id", "conversation_key", "url", "ox", "mime", "size", "created_at", "order_at", "downloaded_at" FROM `message_attachments`;--> statement-breakpoint
DROP TABLE `message_attachments`;--> statement-breakpoint
ALTER TABLE `__new_message_attachments` RENAME TO `message_attachments`;--> statement-breakpoint
CREATE INDEX `idx_att_conv_time` ON `message_attachments` (`account_pubkey`,`conversation_key`,`order_at`,`message_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_att_ox` ON `message_attachments` (`ox`);--> statement-breakpoint
CREATE INDEX `idx_att_url` ON `message_attachments` (`url`);
