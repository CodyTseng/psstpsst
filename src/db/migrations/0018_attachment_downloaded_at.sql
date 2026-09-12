-- Split the attachment "on disk" flag out of `mime` into its own `downloaded_at`
-- column. Previously `mime != null` doubled as both the real content type and the
-- "is it on disk" flag, so freeing a blob (orphan GC) nulled `mime` and forgot
-- the type. Now `downloaded_at` is the authoritative presence flag (set on
-- download/upload, nulled on free) and `mime` is kept — a freed row still knows
-- its type. `downloaded_at` also doubles as the recency/age key for a future
-- capacity/TTL reclaim.
--
-- Backfill existing rows: under the old invariant a non-null `mime` meant the
-- blob was on disk, so seed `downloaded_at` from `created_at` for those.
ALTER TABLE `message_attachments` ADD COLUMN `downloaded_at` integer;--> statement-breakpoint
UPDATE `message_attachments` SET `downloaded_at` = `created_at` WHERE `mime` IS NOT NULL;
