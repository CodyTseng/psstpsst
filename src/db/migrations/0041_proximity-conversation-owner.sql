ALTER TABLE `conversations` ADD `proximity_account_pubkey` text;--> statement-breakpoint
CREATE INDEX `idx_conv_backup_owner` ON `conversations` (`account_pubkey`,`delivery_kind`,`proximity_account_pubkey`,`conversation_key`);
