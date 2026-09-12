-- Collapse `conversation_key` to a bare pubkey (the other party, or our own
-- pubkey for note-to-self). Group chat is unsupported: messages with more than
-- one counterparty are now discarded at ingest, so the participant/group
-- plumbing dropped here has no remaining reader.
--
--   - message_participants: a write-only table (never queried) — dropped whole.
--   - conversations.type / group_id / current_participants_key: only meaningful
--     for groups, which no longer exist.
--   - messages.participants_key / group_id: same.
--
-- App is pre-release; no data migration. The `message_fts` triggers reference
-- only content/id/conversation_key/created_at/kind, so DROP COLUMN is safe and
-- leaves full-text search untouched. Indexes over the dropped columns are
-- removed first so SQLite permits the column drops.
DROP TABLE `message_participants`;--> statement-breakpoint
DROP INDEX `idx_conv_group`;--> statement-breakpoint
DROP INDEX `idx_msg_participants`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `group_id`;--> statement-breakpoint
ALTER TABLE `conversations` DROP COLUMN `current_participants_key`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `participants_key`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `group_id`;
