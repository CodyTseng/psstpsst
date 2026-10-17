ALTER TABLE `napplet_installations` ADD `desktop_position` integer;
--> statement-breakpoint
WITH positions AS (
  SELECT account_pubkey, app_key,
    row_number() OVER (
      PARTITION BY account_pubkey
      ORDER BY pinned_at DESC, last_used_at DESC, app_key
    ) - 1 AS position
  FROM napplet_installations
  WHERE last_used_at IS NOT NULL OR pinned_at IS NOT NULL
)
UPDATE napplet_installations SET desktop_position = (
  SELECT position FROM positions
  WHERE positions.account_pubkey = napplet_installations.account_pubkey
    AND positions.app_key = napplet_installations.app_key
);
--> statement-breakpoint
ALTER TABLE `napplet_installations` DROP COLUMN `pinned_at`;
--> statement-breakpoint
CREATE INDEX `napplet_desktop` ON `napplet_installations` (`account_pubkey`, `desktop_position`);
