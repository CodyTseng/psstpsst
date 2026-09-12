CREATE TABLE `pending_attachments` (
	`account_pubkey` text NOT NULL,
	`temp_id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`local_name` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`name` text,
	`size` integer,
	`duration_sec` integer,
	`waveform` text,
	`status` text NOT NULL,
	`started_at` integer,
	`reply_to_id` text,
	`error` text,
	PRIMARY KEY(`account_pubkey`, `temp_id`)
);
