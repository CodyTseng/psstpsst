DROP INDEX `idx_conv_last_msg`;--> statement-breakpoint
CREATE INDEX `idx_conv_inbox` ON `conversations` (
  `account_pubkey`, `deleted`, `has_replied`, `pinned`,
  `updated_order_at`, `conversation_key`
);
