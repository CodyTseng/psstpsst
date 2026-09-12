DROP INDEX `idx_att_conv`;--> statement-breakpoint
CREATE INDEX `idx_att_conv_time` ON `message_attachments` (`conversation_key`,`created_at`);
