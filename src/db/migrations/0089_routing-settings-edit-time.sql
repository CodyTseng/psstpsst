ALTER TABLE routing_settings_edits ADD COLUMN edited_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Reconstruct the best available time from the legacy debounce or retry deadline.
UPDATE routing_settings_edits
SET edited_at = MAX(0, (next_attempt_at - CASE attempts
  WHEN 0 THEN 2000 WHEN 1 THEN 1000 WHEN 2 THEN 2000 WHEN 3 THEN 5000
  WHEN 4 THEN 10000 WHEN 5 THEN 30000 ELSE 60000 END) / 1000);
