CREATE TABLE `wallets` (
  `id` text PRIMARY KEY NOT NULL,
  `account_pubkey` text NOT NULL,
  `wallet_pubkey` text NOT NULL,
  `relays_json` text NOT NULL,
  `name` text NOT NULL,
  `custom_name` text,
  `lud16` text,
  `capabilities_json` text,
  `notifications_json` text,
  `budget_json` text,
  `is_default` integer DEFAULT false NOT NULL,
  `connected_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_sync_at` integer,
  FOREIGN KEY (`account_pubkey`) REFERENCES `accounts`(`pubkey`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wallets_account` ON `wallets` (`account_pubkey`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wallets_one_default` ON `wallets` (`account_pubkey`, `is_default`) WHERE `is_default` = true;
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
  `id` text PRIMARY KEY NOT NULL,
  `wallet_id` text NOT NULL,
  `account_pubkey` text NOT NULL,
  `type` text NOT NULL,
  `state` text NOT NULL,
  `invoice` text,
  `description` text,
  `payment_hash` text,
  `preimage` text,
  `amount_msat` integer,
  `fees_paid_msat` integer,
  `created_at` integer NOT NULL,
  `expires_at` integer,
  `settled_at` integer,
  `raw_json` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_pubkey`) REFERENCES `accounts`(`pubkey`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_transactions_wallet_created` ON `wallet_transactions` (`wallet_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_wallet_transactions_account` ON `wallet_transactions` (`account_pubkey`);
