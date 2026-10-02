ALTER TABLE `observed_peer_encryption_keys` ADD `announcement_checked_at` integer;
--> statement-breakpoint
UPDATE `observed_peer_encryption_keys`
SET `announcement_checked_at` = (
	SELECT `fetched_at`
	FROM `encryption_key_announcements`
	WHERE `encryption_key_announcements`.`pubkey` = `observed_peer_encryption_keys`.`peer_pubkey`
)
WHERE EXISTS (
	SELECT 1
	FROM `encryption_key_announcements`
	WHERE `encryption_key_announcements`.`pubkey` = `observed_peer_encryption_keys`.`peer_pubkey`
);
