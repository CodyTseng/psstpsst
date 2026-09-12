CREATE TABLE `configuration_outbox` (
	`account_pubkey` text NOT NULL,
	`kind` integer NOT NULL,
	`d_tag` text DEFAULT '' NOT NULL,
	`event_id` text NOT NULL,
	`event` text NOT NULL,
	`acknowledged_relays` text DEFAULT '[]' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	PRIMARY KEY(`account_pubkey`, `kind`, `d_tag`),
	FOREIGN KEY (`account_pubkey`) REFERENCES `accounts`(`pubkey`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_configuration_outbox_due` ON `configuration_outbox` (`account_pubkey`,`next_attempt_at`);