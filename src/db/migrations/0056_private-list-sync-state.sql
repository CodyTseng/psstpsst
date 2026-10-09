CREATE TABLE `private_list_sync_state` (
  `account_pubkey` text NOT NULL,
  `d_tag` text NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `dirty` integer DEFAULT false NOT NULL,
  `event_id` text,
  PRIMARY KEY (`account_pubkey`, `d_tag`),
  FOREIGN KEY (`account_pubkey`) REFERENCES `accounts`(`pubkey`) ON UPDATE no action ON DELETE cascade
);
