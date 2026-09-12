ALTER TABLE `proximity_peers` ADD `connected_at` integer;--> statement-breakpoint
ALTER TABLE `proximity_peers` ADD `blocked_at` integer;--> statement-breakpoint
UPDATE `proximity_peers`
SET `connected_at` = `last_seen_at`
WHERE EXISTS (
	SELECT 1 FROM `conversations`
	WHERE `conversations`.`account_pubkey` = `proximity_peers`.`account_pubkey`
		AND `conversations`.`conversation_key` = `proximity_peers`.`proximity_pubkey`
		AND `conversations`.`delivery_kind` = 'proximity'
);
