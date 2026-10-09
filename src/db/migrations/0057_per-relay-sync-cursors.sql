-- Global cursors cannot establish coverage for any individual relay. Start
-- each relay from an unconfirmed frontier; processed envelopes remain deduped.
DROP TABLE `sync_cursors`;
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
  `account_pubkey` text NOT NULL,
  `relay_url` text NOT NULL,
  `forward_since` integer,
  `backward_until` integer,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`account_pubkey`, `relay_url`)
);
