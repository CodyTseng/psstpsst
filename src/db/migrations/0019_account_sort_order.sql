-- Manual account ordering. The account switcher used to sort by `last_active_at`,
-- so switching reshuffled the list — bad for blind/muscle-memory operation. Add a
-- `sort_order` the user controls (drag-reorder in the account manager); switching
-- now only touches `last_active_at` and never moves a row.
--
-- Seed existing rows from `added_at` (insertion order). New rows are inserted with
-- `sort_order = added_at` too, which always sorts *after* a reordered set's small
-- (0,1,2,…) indices, so a freshly added account appends to the end.
ALTER TABLE `accounts` ADD COLUMN `sort_order` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `accounts` SET `sort_order` = `added_at`;
