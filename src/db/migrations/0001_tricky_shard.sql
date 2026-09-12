CREATE TABLE `contacts` (
	`account_pubkey` text NOT NULL,
	`pubkey` text NOT NULL,
	`added_at` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	PRIMARY KEY(`account_pubkey`, `pubkey`)
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_account` ON `contacts` (`account_pubkey`);