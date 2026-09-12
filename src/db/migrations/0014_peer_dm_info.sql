CREATE TABLE `peer_dm_info` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`encryption_pubkey` text NOT NULL,
	`dm_relays` text NOT NULL,
	`checked_at` integer NOT NULL
);
