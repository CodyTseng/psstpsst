ALTER TABLE conversations ADD COLUMN reaction_preview_event_id text;
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN reaction_preview_order_at integer;
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN reaction_preview_pending integer NOT NULL DEFAULT 0;
