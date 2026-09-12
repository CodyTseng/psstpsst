CREATE TABLE `proximity_file_partials` (
	`account_pubkey` text NOT NULL,
	`rumor_id` text NOT NULL,
	`representation` text NOT NULL,
	`peer_pubkey` text NOT NULL,
	`x` text NOT NULL,
	`ox` text NOT NULL,
	`expected_size` integer NOT NULL,
	`offset` integer NOT NULL,
	`local_name` text NOT NULL,
	`mime` text NOT NULL,
	`url` text NOT NULL,
	`last_progress_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `rumor_id`, `representation`)
);
--> statement-breakpoint
CREATE INDEX `idx_proximity_file_partial_expiry` ON `proximity_file_partials` (`account_pubkey`,`last_progress_at`);--> statement-breakpoint
CREATE TABLE `proximity_file_spools` (
	`account_pubkey` text NOT NULL,
	`x` text NOT NULL,
	`ox` text NOT NULL,
	`local_name` text NOT NULL,
	`cipher_size` integer NOT NULL,
	`plain_size` integer NOT NULL,
	`key_hex` text NOT NULL,
	`nonce_hex` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `x`)
);
--> statement-breakpoint
CREATE TABLE `proximity_file_uploads` (
	`account_pubkey` text NOT NULL,
	`x` text NOT NULL,
	`server` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`uploaded_at` integer,
	PRIMARY KEY(`account_pubkey`, `x`, `server`)
);
--> statement-breakpoint
CREATE INDEX `idx_proximity_file_upload_drain` ON `proximity_file_uploads` (`account_pubkey`,`status`,`next_attempt_at`);