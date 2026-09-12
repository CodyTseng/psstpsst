UPDATE `conversations`
SET `has_replied` = 1
WHERE `delivery_kind` = 'proximity'
	AND `deleted` = 0
	AND `has_replied` = 0
	AND EXISTS (
		SELECT 1 FROM `proximity_peers`
		WHERE `proximity_peers`.`account_pubkey` = `conversations`.`account_pubkey`
			AND `proximity_peers`.`proximity_pubkey` = `conversations`.`conversation_key`
			AND `proximity_peers`.`connected_at` IS NOT NULL
			AND `proximity_peers`.`blocked_at` IS NULL
	);
