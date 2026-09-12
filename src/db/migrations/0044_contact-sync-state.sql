CREATE TABLE `contact_sync_state` (
	`account_pubkey` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT false NOT NULL,
	`event_created_at` integer,
	`event_id` text,
	FOREIGN KEY (`account_pubkey`) REFERENCES `accounts`(`pubkey`) ON UPDATE no action ON DELETE cascade
);
