CREATE TABLE `observed_peer_encryption_keys` (
	`peer_pubkey` text PRIMARY KEY NOT NULL,
	`encryption_pubkey` text NOT NULL,
	`source` text NOT NULL,
	`evidence_id` text NOT NULL,
	`evidence_created_at` integer NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `observed_peer_encryption_keys` (
	`peer_pubkey`, `encryption_pubkey`, `source`,
	`evidence_id`, `evidence_created_at`, `observed_at`
)
SELECT
	`pubkey`,
	`encryption_pubkey`,
	'kind-10044',
	`event_id`,
	`event_created_at` * 1000,
	`fetched_at`
FROM `encryption_key_announcements`;
