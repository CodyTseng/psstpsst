CREATE TABLE `notification_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_pubkey` text NOT NULL,
  `conversation_key` text NOT NULL,
  `message_id` text NOT NULL,
  `kind` text NOT NULL,
  `target` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_pubkey`, `message_id`) REFERENCES `messages` (`account_pubkey`, `id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notification_event_message` ON `notification_events` (`account_pubkey`, `message_id`);
--> statement-breakpoint
CREATE INDEX `idx_notification_event_delivery` ON `notification_events` (`account_pubkey`, `target`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_notification_event_expiry` ON `notification_events` (`created_at`);
