CREATE TABLE `message_drafts` (
	`account_pubkey` text NOT NULL,
	`conversation_key` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `conversation_key`)
);
