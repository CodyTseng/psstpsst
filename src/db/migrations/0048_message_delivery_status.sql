ALTER TABLE `messages` ADD `delivery_status` text;--> statement-breakpoint

-- Pending work is account-scoped and wins over an older settled summary. Only
-- the coarse state needed by a list row is copied; retry payloads and errors
-- remain in outbox.
UPDATE `messages`
SET `delivery_status` = CASE (
	SELECT `outbox`.`status`
	FROM `outbox`
	WHERE `outbox`.`account_pubkey` = `messages`.`account_pubkey`
		AND `outbox`.`message_id` = `messages`.`id`
	LIMIT 1
)
	WHEN 'sent' THEN 'sent'
	WHEN 'failed' THEN 'failed'
	ELSE 'queued'
END
WHERE EXISTS (
	SELECT 1
	FROM `outbox`
	WHERE `outbox`.`account_pubkey` = `messages`.`account_pubkey`
		AND `outbox`.`message_id` = `messages`.`id`
);--> statement-breakpoint

-- Backfill settled locally-authored rows. Relay authors use the account key;
-- Nearby authors use the conversation's device-local identity.
UPDATE `messages`
SET `delivery_status` = (
	SELECT `message_deliveries`.`status`
	FROM `message_deliveries`
	WHERE `message_deliveries`.`message_id` = `messages`.`id`
	LIMIT 1
)
WHERE `delivery_status` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `message_deliveries`
		WHERE `message_deliveries`.`message_id` = `messages`.`id`
	)
	AND (
		`messages`.`sender_pubkey` = `messages`.`account_pubkey`
		OR EXISTS (
			SELECT 1
			FROM `conversations`
			WHERE `conversations`.`account_pubkey` = `messages`.`account_pubkey`
				AND `conversations`.`conversation_key` = `messages`.`conversation_key`
				AND `conversations`.`delivery_kind` = 'proximity'
				AND `conversations`.`proximity_account_pubkey` = `messages`.`sender_pubkey`
		)
	);
