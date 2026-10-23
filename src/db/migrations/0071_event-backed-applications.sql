ALTER TABLE referenced_events RENAME TO cached_events;
--> statement-breakpoint
DROP INDEX idx_referenced_events_fetched_at;
--> statement-breakpoint
CREATE INDEX idx_cached_events_fetched_at ON cached_events(fetched_at);
--> statement-breakpoint
ALTER TABLE private_list_sync_state ADD COLUMN draft text;
--> statement-breakpoint
ALTER TABLE private_list_sync_state ADD COLUMN snapshot text;
--> statement-breakpoint
ALTER TABLE explore_shortcuts RENAME TO legacy_explore_shortcuts;
--> statement-breakpoint
CREATE VIEW application_favorite_references AS
SELECT DISTINCT json_extract(ref.value,'$[0]') AS type,json_extract(ref.value,'$[1]') AS reference
FROM private_list_sync_state,
 json_each(CASE WHEN dirty=1 AND draft IS NOT NULL THEN draft ELSE COALESCE(json_extract(snapshot,'$.tags'),'[]') END) ref
WHERE kind=30267 AND d_tag='psstpsst-favorites';
--> statement-breakpoint
CREATE INDEX replaceable_cache_freshness ON replaceable_events(kind,fetched_at);

--> statement-breakpoint
UPDATE napplet_installations SET previous_manifest=NULL;
