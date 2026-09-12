CREATE TABLE `message_attachments` (
	`message_id` text PRIMARY KEY NOT NULL,
	`conversation_key` text NOT NULL,
	`url` text NOT NULL,
	`ox` text,
	`mime` text,
	`size` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_att_conv` ON `message_attachments` (`conversation_key`);
--> statement-breakpoint
CREATE INDEX `idx_att_ox` ON `message_attachments` (`ox`);
--> statement-breakpoint
CREATE INDEX `idx_att_url` ON `message_attachments` (`url`);
