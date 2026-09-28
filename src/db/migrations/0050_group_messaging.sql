CREATE TABLE `group_member_actions` (
	`account_pubkey` text NOT NULL,
	`conversation_key` text NOT NULL,
	`event_id` text NOT NULL,
	`author_pubkey` text NOT NULL,
	`member_pubkey` text NOT NULL,
	`action` text NOT NULL,
	`order_at` integer NOT NULL,
	`rumor` text NOT NULL,
	`applied` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_group_action_order` ON `group_member_actions` (`account_pubkey`,`conversation_key`,`order_at` ASC,`event_id` DESC);--> statement-breakpoint
CREATE TABLE `pending_group_rumors` (
	`account_pubkey` text NOT NULL,
	`conversation_key` text NOT NULL,
	`message_id` text NOT NULL,
	`order_at` integer NOT NULL,
	`sender_pubkey` text NOT NULL,
	`rumor` text NOT NULL,
	`source_relays` text,
	`pending_reason` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `message_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pending_group_order` ON `pending_group_rumors` (`account_pubkey`,`conversation_key`,`order_at` ASC,`message_id` DESC);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`account_pubkey` text NOT NULL,
	`conversation_key` text NOT NULL,
	`delivery_kind` text DEFAULT 'relay' NOT NULL,
	`proximity_account_pubkey` text,
	`name` text,
	`created_at` integer NOT NULL,
	`created_order_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_order_at` integer NOT NULL,
	`last_message_at` integer,
	`last_message_order_at` integer,
	`last_message_id` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`has_replied` integer DEFAULT false NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`deleted_order_at` integer,
	`muted` integer DEFAULT false NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`last_read_at` integer,
	`last_read_order_at` integer,
	`last_read_message_id` text,
	`group_id` text,
	`member_pubkeys` text,
	`members_bootstrap_order_at` integer,
	`members_bootstrap_event_id` text,
	`members_action_order_at` integer,
	`members_action_event_id` text,
	`name_order_at` integer,
	`name_event_id` text,
	PRIMARY KEY(`account_pubkey`, `conversation_key`)
);
--> statement-breakpoint
INSERT INTO `__new_conversations`(
	"account_pubkey", "conversation_key", "delivery_kind",
	"proximity_account_pubkey", "name",
	"created_at", "created_order_at", "updated_at", "updated_order_at",
	"last_message_at", "last_message_order_at", "last_message_id",
	"unread_count", "has_replied", "deleted", "deleted_at",
	"deleted_order_at", "muted", "pinned", "last_read_at",
	"last_read_order_at", "last_read_message_id"
)
SELECT
	`conversation`.`account_pubkey`,
	`conversation`.`conversation_key`,
	`conversation`.`delivery_kind`,
	`conversation`.`proximity_account_pubkey`,
	`conversation`.`name`,
	COALESCE(
		(
			SELECT `message`.`created_at`
			FROM `messages` AS `message`
			WHERE `message`.`account_pubkey` = `conversation`.`account_pubkey`
				AND `message`.`conversation_key` = `conversation`.`conversation_key`
			ORDER BY `message`.`order_at` ASC, `message`.`id` DESC
			LIMIT 1
		),
		`conversation`.`last_message_at`
	),
	COALESCE(
		(
			SELECT `message`.`order_at`
			FROM `messages` AS `message`
			WHERE `message`.`account_pubkey` = `conversation`.`account_pubkey`
				AND `message`.`conversation_key` = `conversation`.`conversation_key`
			ORDER BY `message`.`order_at` ASC, `message`.`id` DESC
			LIMIT 1
		),
		`conversation`.`last_message_order_at`
	),
	CASE
		WHEN COALESCE(`draft`.`updated_at`, 0) > `conversation`.`last_message_at`
			THEN `draft`.`updated_at`
		ELSE `conversation`.`last_message_at`
	END,
	MAX(
		`conversation`.`last_message_order_at`,
		COALESCE(`draft`.`updated_at` * 1000, 0)
	),
	`conversation`.`last_message_at`,
	`conversation`.`last_message_order_at`,
	`conversation`.`last_message_id`,
	`conversation`.`unread_count`,
	`conversation`.`has_replied`,
	`conversation`.`deleted`,
	`conversation`.`deleted_at`,
	`conversation`.`deleted_order_at`,
	`conversation`.`muted`,
	`conversation`.`pinned`,
	`conversation`.`last_read_at`,
	`conversation`.`last_read_order_at`,
	`conversation`.`last_read_message_id`
FROM `conversations` AS `conversation`
LEFT JOIN `message_drafts` AS `draft`
	ON `draft`.`account_pubkey` = `conversation`.`account_pubkey`
	AND `draft`.`conversation_key` = `conversation`.`conversation_key`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_conv_last_msg` ON `conversations` (`account_pubkey`,`last_message_order_at`);--> statement-breakpoint
CREATE INDEX `idx_conv_activity` ON `conversations` (`account_pubkey`,`updated_order_at`,`conversation_key`);--> statement-breakpoint
CREATE INDEX `idx_conv_backup_owner` ON `conversations` (`account_pubkey`,`delivery_kind`,`proximity_account_pubkey`,`conversation_key`);--> statement-breakpoint

-- Treat every message at the read cursor's millisecond as read. The shared
-- ordering rule makes the minimum id the newest event at an equal order_at.
UPDATE `conversations` AS `conversation`
SET `last_read_message_id` = (
	SELECT MIN(`message`.`id`)
	FROM `messages` AS `message`
	WHERE `message`.`account_pubkey` = `conversation`.`account_pubkey`
		AND `message`.`conversation_key` = `conversation`.`conversation_key`
		AND `message`.`order_at` = `conversation`.`last_read_order_at`
)
WHERE `conversation`.`last_read_order_at` IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM `messages` AS `message`
		WHERE `message`.`account_pubkey` = `conversation`.`account_pubkey`
			AND `message`.`conversation_key` = `conversation`.`conversation_key`
			AND `message`.`order_at` = `conversation`.`last_read_order_at`
	);--> statement-breakpoint

-- Recompute unread state from the repaired cursor with the same 100-row cap
-- used at runtime. The mixed-direction message index bounds every scan.
UPDATE `conversations` AS `conversation`
SET `unread_count` = (
	SELECT COUNT(*)
	FROM (
		SELECT `message`.`id`
		FROM `messages` AS `message`
		WHERE `message`.`account_pubkey` = `conversation`.`account_pubkey`
			AND `message`.`conversation_key` = `conversation`.`conversation_key`
			AND `message`.`kind` IN (14, 15)
			AND (
				`conversation`.`last_read_order_at` IS NULL
				OR `message`.`order_at` > `conversation`.`last_read_order_at`
				OR (
					`message`.`order_at` = `conversation`.`last_read_order_at`
					AND `conversation`.`last_read_message_id` IS NOT NULL
					AND `message`.`id` < `conversation`.`last_read_message_id`
				)
			)
		ORDER BY `message`.`order_at` ASC, `message`.`id` DESC
		LIMIT 100
	)
);--> statement-breakpoint
ALTER TABLE `message_delivery_copies` ADD `error` text;--> statement-breakpoint
ALTER TABLE `relay_outbox_jobs` ADD `recipient_pubkey` text;
