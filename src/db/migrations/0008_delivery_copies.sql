DROP TABLE IF EXISTS `message_deliveries`;
--> statement-breakpoint
CREATE TABLE `message_deliveries` (
	`message_id` text PRIMARY KEY NOT NULL,
	`conversation_key` text NOT NULL,
	`copies` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_conversation` ON `message_deliveries` (`conversation_key`);
