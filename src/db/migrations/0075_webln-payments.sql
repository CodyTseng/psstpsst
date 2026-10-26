CREATE TABLE `webln_payments` (
  `account_pubkey` text NOT NULL REFERENCES `accounts` (`pubkey`) ON DELETE CASCADE,
  `payment_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`account_pubkey`, `payment_hash`)
);
