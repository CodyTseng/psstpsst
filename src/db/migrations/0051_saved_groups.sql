CREATE TABLE `saved_groups` (
	`account_pubkey` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`account_pubkey`, `group_id`)
);
