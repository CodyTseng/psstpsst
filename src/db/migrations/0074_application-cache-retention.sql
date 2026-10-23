-- Repair databases that applied an earlier revision of migration 0071.
CREATE VIEW IF NOT EXISTS application_favorite_references AS
SELECT DISTINCT json_extract(ref.value,'$[0]') AS type,json_extract(ref.value,'$[1]') AS reference
FROM private_list_sync_state,
 json_each(CASE WHEN dirty=1 AND draft IS NOT NULL THEN draft ELSE COALESCE(json_extract(snapshot,'$.tags'),'[]') END) ref
WHERE kind=30267 AND d_tag='psstpsst-favorites';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS replaceable_cache_freshness ON replaceable_events(kind,fetched_at);
