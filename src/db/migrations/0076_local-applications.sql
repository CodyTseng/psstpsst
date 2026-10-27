CREATE TABLE `local_applications` (
  `account_pubkey` text NOT NULL REFERENCES `accounts`(`pubkey`) ON DELETE CASCADE,
  `app_id` text NOT NULL,
  `version` text NOT NULL,
  `installer` text NOT NULL,
  `entry` text NOT NULL,
  `desktop_position` integer,
  PRIMARY KEY (`account_pubkey`, `app_id`)
);
