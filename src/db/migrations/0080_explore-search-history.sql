CREATE TABLE `explore_search_history` (
  `account_pubkey` text NOT NULL REFERENCES `accounts` (`pubkey`) ON DELETE CASCADE,
  `address` text NOT NULL,
  `used_at` integer NOT NULL,
  PRIMARY KEY (`account_pubkey`, `address`)
);
--> statement-breakpoint
CREATE INDEX `explore_search_history_order` ON `explore_search_history` (`account_pubkey`, `used_at`);
