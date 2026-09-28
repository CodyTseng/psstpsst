CREATE TABLE `message_delivery_copies` (
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`recipient_pubkey` text NOT NULL,
	`relays` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `message_id`, `recipient_pubkey`)
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_copy_message` ON `message_delivery_copies` (`account_pubkey`,`message_id`);--> statement-breakpoint
CREATE TABLE `relay_outbox_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_relay_outbox_fifo` ON `relay_outbox_jobs` (`account_pubkey`,`id`);--> statement-breakpoint
CREATE INDEX `idx_relay_outbox_message` ON `relay_outbox_jobs` (`account_pubkey`,`message_id`);--> statement-breakpoint
CREATE TABLE `relay_outbox_job_targets` (
	`job_id` integer NOT NULL,
	`recipient_pubkey` text NOT NULL,
	`relay_url` text NOT NULL,
	PRIMARY KEY(`job_id`, `recipient_pubkey`, `relay_url`),
	FOREIGN KEY (`job_id`) REFERENCES `relay_outbox_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_relay_outbox_target_job` ON `relay_outbox_job_targets` (`job_id`);--> statement-breakpoint
CREATE TABLE `relay_outbox_payloads` (
	`job_id` integer NOT NULL,
	`recipient_pubkey` text NOT NULL,
	`gift_wrap` text NOT NULL,
	PRIMARY KEY(`job_id`, `recipient_pubkey`),
	FOREIGN KEY (`job_id`) REFERENCES `relay_outbox_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `delivery_error` text;--> statement-breakpoint

-- Preserve settled relay detail. The legacy table was not account-scoped, so
-- only a uniquely identifiable locally-authored message owns migrated copies.
INSERT OR IGNORE INTO `message_delivery_copies` (
	`account_pubkey`, `message_id`, `recipient_pubkey`, `relays`, `updated_at`
)
SELECT
	`messages`.`account_pubkey`,
	`message_deliveries`.`message_id`,
	json_extract(`copy`.`value`, '$.recipient'),
	json_extract(`copy`.`value`, '$.relays'),
	`message_deliveries`.`updated_at`
FROM `message_deliveries`
JOIN `messages`
	ON `messages`.`id` = `message_deliveries`.`message_id`
	AND `messages`.`sender_pubkey` = `messages`.`account_pubkey`
JOIN json_each(
	CASE WHEN json_valid(`message_deliveries`.`copies`)
		THEN `message_deliveries`.`copies` ELSE '[]' END
) AS `copy`
WHERE json_valid(`message_deliveries`.`copies`)
	AND json_type(`copy`.`value`, '$.recipient') = 'text'
	AND json_type(`copy`.`value`, '$.relays') = 'array';--> statement-breakpoint

-- Only unfinished legacy relay work resumes automatically. Explicit failures
-- remain settled for a user-initiated retry; completed work is discarded.
INSERT INTO `relay_outbox_jobs` (`account_pubkey`, `message_id`, `scope`, `created_at`)
SELECT
	`account_pubkey`,
	`message_id`,
	CASE
		WHEN json_valid(`pending_payload`)
			AND json_type(`pending_payload`, '$.copies') = 'array'
			AND json_array_length(json_extract(`pending_payload`, '$.copies')) > 0
		THEN 'selected_targets'
		ELSE 'all_recipient_relays'
	END,
	`updated_at`
FROM `outbox`
WHERE `delivery_kind` = 'relay'
	AND `status` IN ('queued', 'sending');--> statement-breakpoint

INSERT OR IGNORE INTO `relay_outbox_payloads` (`job_id`, `recipient_pubkey`, `gift_wrap`)
SELECT
	`job`.`id`,
	json_extract(`copy`.`value`, '$.recipientPubkey'),
	json_extract(`copy`.`value`, '$.giftWrap')
FROM `relay_outbox_jobs` AS `job`
JOIN `outbox`
	ON `outbox`.`account_pubkey` = `job`.`account_pubkey`
	AND `outbox`.`message_id` = `job`.`message_id`
JOIN json_each(
	CASE WHEN json_valid(`outbox`.`pending_payload`)
		THEN json_extract(`outbox`.`pending_payload`, '$.copies') ELSE '[]' END
) AS `copy`
WHERE `outbox`.`delivery_kind` = 'relay'
	AND json_type(`copy`.`value`, '$.recipientPubkey') = 'text'
	AND json_type(`copy`.`value`, '$.giftWrap') = 'object';--> statement-breakpoint

INSERT OR IGNORE INTO `relay_outbox_job_targets` (`job_id`, `recipient_pubkey`, `relay_url`)
SELECT
	`job`.`id`,
	json_extract(`copy`.`value`, '$.recipientPubkey'),
	`relay`.`value`
FROM `relay_outbox_jobs` AS `job`
JOIN `outbox`
	ON `outbox`.`account_pubkey` = `job`.`account_pubkey`
	AND `outbox`.`message_id` = `job`.`message_id`
JOIN json_each(
	CASE WHEN json_valid(`outbox`.`pending_payload`)
		THEN json_extract(`outbox`.`pending_payload`, '$.copies') ELSE '[]' END
) AS `copy`
JOIN json_each(json_extract(`copy`.`value`, '$.relayUrls')) AS `relay`
WHERE `outbox`.`delivery_kind` = 'relay'
	AND json_type(`copy`.`value`, '$.recipientPubkey') = 'text'
	AND `relay`.`type` = 'text';--> statement-breakpoint

-- Recovered jobs that already had signed payloads need durable pending copies
-- even though the legacy implementation had not settled its delivery summary.
INSERT OR IGNORE INTO `message_delivery_copies` (
	`account_pubkey`, `message_id`, `recipient_pubkey`, `relays`, `updated_at`
)
SELECT
	`job`.`account_pubkey`,
	`job`.`message_id`,
	`target`.`recipient_pubkey`,
	json_group_array(json_object('url', `target`.`relay_url`, 'status', 'pending')),
	`job`.`created_at`
FROM `relay_outbox_jobs` AS `job`
JOIN `relay_outbox_job_targets` AS `target` ON `target`.`job_id` = `job`.`id`
JOIN `messages`
	ON `messages`.`account_pubkey` = `job`.`account_pubkey`
	AND `messages`.`id` = `job`.`message_id`
	AND `messages`.`kind` IN (14, 15)
GROUP BY `job`.`account_pubkey`, `job`.`message_id`, `target`.`recipient_pubkey`;--> statement-breakpoint

UPDATE `messages`
SET `delivery_error` = (
	SELECT `outbox`.`last_error`
	FROM `outbox`
	WHERE `outbox`.`account_pubkey` = `messages`.`account_pubkey`
		AND `outbox`.`message_id` = `messages`.`id`
		AND `outbox`.`delivery_kind` = 'relay'
		AND `outbox`.`status` = 'failed'
	LIMIT 1
)
WHERE NOT EXISTS (
	SELECT 1
	FROM `message_delivery_copies`
	WHERE `message_delivery_copies`.`account_pubkey` = `messages`.`account_pubkey`
		AND `message_delivery_copies`.`message_id` = `messages`.`id`
);--> statement-breakpoint

DELETE FROM `outbox` WHERE `delivery_kind` = 'relay';--> statement-breakpoint
DROP TABLE `message_deliveries`;
