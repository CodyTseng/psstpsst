CREATE TABLE `peer_relay_metadata` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`event` text,
	`fetched_at` integer NOT NULL
);
