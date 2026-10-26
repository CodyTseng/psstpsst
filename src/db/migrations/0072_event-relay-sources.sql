ALTER TABLE replaceable_events ADD COLUMN relays text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE cached_events ADD COLUMN relays text NOT NULL DEFAULT '[]';
