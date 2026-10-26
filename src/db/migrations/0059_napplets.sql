CREATE TABLE `napplet_installations` (
  `account_pubkey` text NOT NULL REFERENCES `accounts`(`pubkey`) ON DELETE CASCADE,
  `app_key` text NOT NULL,
  `manifest` text NOT NULL,
  `artifact_hash` text NOT NULL,
  `previous_manifest` text,
  `last_used_at` integer,
  `pinned_at` integer,
  PRIMARY KEY (`account_pubkey`, `app_key`)
);
--> statement-breakpoint
CREATE INDEX `napplet_recent` ON `napplet_installations` (`account_pubkey`, `last_used_at`);
--> statement-breakpoint
CREATE TABLE `napplet_data` (
  `account_pubkey` text NOT NULL REFERENCES `accounts`(`pubkey`) ON DELETE CASCADE,
  `app_key` text NOT NULL,
  `artifact_hash` text NOT NULL,
  `bucket` text NOT NULL,
  `key` text NOT NULL,
  `value` text NOT NULL,
  `bytes` integer NOT NULL,
  PRIMARY KEY (`account_pubkey`, `app_key`, `artifact_hash`, `bucket`, `key`)
);
--> statement-breakpoint
CREATE TABLE `napplet_usage` (
  `account_pubkey` text NOT NULL REFERENCES `accounts`(`pubkey`) ON DELETE CASCADE,
  `app_key` text NOT NULL,
  `artifact_hash` text NOT NULL,
  `bucket` text NOT NULL,
  `bytes` integer NOT NULL DEFAULT 0,
  `count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`account_pubkey`, `app_key`, `artifact_hash`, `bucket`)
);
