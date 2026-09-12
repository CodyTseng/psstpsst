CREATE TABLE `accounts` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`signer_type` text NOT NULL,
	`signer_payload` text,
	`encryption_pubkey` text,
	`added_at` integer NOT NULL,
	`last_active_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_last_active` ON `accounts` (`last_active_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`account_pubkey` text NOT NULL,
	`conversation_key` text NOT NULL,
	`type` text NOT NULL,
	`group_id` text,
	`current_participants_key` text NOT NULL,
	`name` text,
	`last_message_at` integer NOT NULL,
	`last_message_id` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`has_replied` integer DEFAULT false NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`muted` integer DEFAULT false NOT NULL,
	`last_read_at` integer,
	PRIMARY KEY(`account_pubkey`, `conversation_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_conv_last_msg` ON `conversations` (`account_pubkey`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_conv_group` ON `conversations` (`group_id`);--> statement-breakpoint
CREATE TABLE `encryption_key_announcements` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`encryption_pubkey` text NOT NULL,
	`event_id` text NOT NULL,
	`event_created_at` integer NOT NULL,
	`raw_event` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_participants` (
	`message_id` text NOT NULL,
	`pubkey` text NOT NULL,
	PRIMARY KEY(`message_id`, `pubkey`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mp_pubkey` ON `message_participants` (`pubkey`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_key` text NOT NULL,
	`participants_key` text NOT NULL,
	`group_id` text,
	`sender_pubkey` text NOT NULL,
	`kind` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`reply_to_id` text,
	`subject` text,
	`tags` text NOT NULL,
	`rumor` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_msg_conv_time` ON `messages` (`conversation_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_msg_participants` ON `messages` (`participants_key`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`message_id` text PRIMARY KEY NOT NULL,
	`account_pubkey` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`pending_payload` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_account_status` ON `outbox` (`account_pubkey`,`status`);--> statement-breakpoint
CREATE TABLE `processed_sync_requests` (
	`event_id` text PRIMARY KEY NOT NULL,
	`account_pubkey` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_psr_account` ON `processed_sync_requests` (`account_pubkey`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`name` text,
	`display_name` text,
	`picture` text,
	`nip05` text,
	`about` text,
	`raw_event` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relay_lists` (
	`account_pubkey` text NOT NULL,
	`relay_url` text NOT NULL,
	`read` integer DEFAULT true NOT NULL,
	`write` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `relay_url`)
);
--> statement-breakpoint
CREATE INDEX `idx_relay_lists_account` ON `relay_lists` (`account_pubkey`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`account_pubkey` text PRIMARY KEY NOT NULL,
	`forward_since` integer,
	`backward_until` integer,
	`updated_at` integer NOT NULL
);
