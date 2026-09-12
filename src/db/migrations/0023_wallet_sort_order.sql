-- Manual wallet ordering. The wallet picker used to sort the active wallet to
-- the top, so switching wallets reshuffled the list. Add a user-controlled
-- `sort_order`: selecting only flips `is_default`; drag-reorder rewrites this.
--
-- Seed existing rows from `connected_at`, matching the append order used when
-- wallets were first connected. Future inserts use max(sort_order) + 1 so a new
-- wallet appends even after the list has been manually reordered to 0,1,2,...
ALTER TABLE `wallets` ADD COLUMN `sort_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `wallets` SET `sort_order` = `connected_at`;--> statement-breakpoint
CREATE INDEX `idx_wallets_account_sort` ON `wallets` (`account_pubkey`, `sort_order`);
