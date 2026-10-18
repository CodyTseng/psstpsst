ALTER TABLE napplet_data RENAME TO napplet_data_legacy;
--> statement-breakpoint
CREATE TABLE napplet_data (
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  app_key text NOT NULL, bucket text NOT NULL, key text NOT NULL,
  value text NOT NULL, bytes integer NOT NULL,
  PRIMARY KEY(account_pubkey, app_key, bucket, key)
);
--> statement-breakpoint
CREATE TEMP TABLE napplet_known_versions AS
SELECT account_pubkey,app_key,artifact_hash,
  (SELECT CASE WHEN json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[0]')='path' THEN json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[2]') ELSE json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[1]') END
   FROM json_each(CASE WHEN json_valid(previous_manifest) THEN previous_manifest ELSE '{}' END,'$.tags') tag
   WHERE (json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[0]')='path' AND json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[1]')='/index.html')
      OR (json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[0]')='x' AND json_array_length(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END)=2)
   ORDER BY CASE WHEN json_extract(CASE WHEN json_valid(tag.value) THEN tag.value ELSE '[]' END,'$[0]')='path' THEN 0 ELSE 1 END LIMIT 1) AS previous_hash
FROM napplet_installations;
--> statement-breakpoint
CREATE TEMP TABLE napplet_merge_candidates AS
WITH versions AS MATERIALIZED (
  SELECT d.*, CASE WHEN d.artifact_hash=i.artifact_hash THEN 0
    WHEN d.artifact_hash=i.previous_hash THEN 1
    ELSE 2 END AS priority
  FROM napplet_data_legacy d LEFT JOIN napplet_known_versions i
    ON d.account_pubkey=i.account_pubkey AND d.app_key=i.app_key
), distinct_values AS (
  SELECT account_pubkey,app_key,bucket,key,count(DISTINCT value) AS alternatives FROM versions GROUP BY account_pubkey,app_key,bucket,key
), ranked AS (
  SELECT v.*, row_number() OVER (PARTITION BY v.account_pubkey,v.app_key,v.bucket,v.key ORDER BY priority,artifact_hash) AS ordinal
  FROM versions v JOIN distinct_values counts USING(account_pubkey,app_key,bucket,key) WHERE (priority<2 OR (
    bucket IN ('storage','config','defaults') AND
    counts.alternatives=1
  )) AND NOT (bucket='permissions' AND key IN ('signing','signing-activity'))
), bounded AS (
  SELECT *, row_number() OVER (PARTITION BY account_pubkey,app_key,bucket ORDER BY priority,key) AS item_count,
    sum(bytes) OVER (PARTITION BY account_pubkey,app_key,bucket ORDER BY priority,key ROWS UNBOUNDED PRECEDING) AS total_bytes
  FROM ranked WHERE ordinal=1
)
SELECT * FROM bounded WHERE item_count<=256 AND total_bytes<=1048576;
--> statement-breakpoint
INSERT INTO napplet_data SELECT account_pubkey,app_key,bucket,key,value,bytes FROM napplet_merge_candidates;
--> statement-breakpoint
DROP TABLE napplet_usage;
--> statement-breakpoint
CREATE TABLE napplet_usage (
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  app_key text NOT NULL, bucket text NOT NULL, bytes integer NOT NULL DEFAULT 0, count integer NOT NULL DEFAULT 0,
  PRIMARY KEY(account_pubkey,app_key,bucket)
);
--> statement-breakpoint
INSERT INTO napplet_usage SELECT account_pubkey,app_key,bucket,sum(bytes),count(*) FROM napplet_data GROUP BY account_pubkey,app_key,bucket;
--> statement-breakpoint
CREATE TABLE signing_authorizations (
  id integer PRIMARY KEY AUTOINCREMENT,
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id text NOT NULL, kind integer NOT NULL CHECK(kind BETWEEN 0 AND 65535), d_tag text NOT NULL DEFAULT '',
  decision text NOT NULL CHECK(decision IN ('allow','deny')), expires_at integer,
  created_at integer NOT NULL, updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX signing_authorization_scope ON signing_authorizations(account_pubkey,source_id,kind,d_tag);
--> statement-breakpoint
WITH candidates AS (
  SELECT d.*,row_number() OVER (PARTITION BY d.account_pubkey,d.app_key ORDER BY CASE WHEN d.artifact_hash=i.artifact_hash THEN 0 ELSE 1 END) AS preferred
  FROM napplet_data_legacy d JOIN napplet_known_versions i ON d.account_pubkey=i.account_pubkey AND d.app_key=i.app_key
  WHERE d.bucket='permissions' AND d.key='signing' AND (d.artifact_hash=i.artifact_hash OR d.artifact_hash=i.previous_hash)
)
INSERT OR IGNORE INTO signing_authorizations(account_pubkey,source_id,kind,d_tag,decision,expires_at,created_at,updated_at)
SELECT d.account_pubkey,d.app_key,json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.kind'),
  CASE WHEN json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.kind') BETWEEN 30000 AND 39999 THEN coalesce(json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.identifier'),'') ELSE '' END,
  json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.decision'),
  CASE WHEN json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.duration')='timed' THEN json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.expiresAt') ELSE NULL END,
  json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.createdAt'),json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.createdAt')
FROM candidates d,
json_each(CASE WHEN json_valid(d.value) THEN d.value ELSE '{}' END,'$.rules') rule
WHERE d.preferred=1 AND json_extract(CASE WHEN json_valid(d.value) THEN d.value ELSE '{}' END,'$.version')=3
  AND json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.operation')='publish'
  AND json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.recipient') IS NULL
  AND json_type(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.kind')='integer' AND json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.scope.kind') BETWEEN 0 AND 65535
  AND json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.decision') IN ('allow','deny')
  AND json_type(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.createdAt')='integer'
  AND (json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.duration')='always' OR (json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.duration')='timed' AND json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.expiresAt')>unixepoch()*1000))
ORDER BY json_extract(CASE WHEN json_valid(rule.value) THEN rule.value ELSE '{}' END,'$.createdAt') DESC;
--> statement-breakpoint
CREATE TABLE signing_activity (
  id integer PRIMARY KEY AUTOINCREMENT,
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id text NOT NULL, operation text NOT NULL, kind integer NOT NULL,
  decision text NOT NULL CHECK(decision IN ('allowed','automatic','denied')), at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX signing_activity_source ON signing_activity(account_pubkey,source_id,id);
--> statement-breakpoint
WITH candidates AS (
  SELECT d.*,row_number() OVER (PARTITION BY d.account_pubkey,d.app_key ORDER BY CASE WHEN d.artifact_hash=i.artifact_hash THEN 0 ELSE 1 END) AS preferred
  FROM napplet_data_legacy d JOIN napplet_known_versions i ON d.account_pubkey=i.account_pubkey AND d.app_key=i.app_key
  WHERE d.bucket='permissions' AND d.key='signing-activity' AND (d.artifact_hash=i.artifact_hash OR d.artifact_hash=i.previous_hash)
)
INSERT INTO signing_activity(account_pubkey,source_id,operation,kind,decision,at)
SELECT d.account_pubkey,d.app_key,json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.scope.operation'),json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.scope.kind'),json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.decision'),json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.at')
FROM candidates d,
json_each(CASE WHEN json_valid(d.value) THEN d.value ELSE '[]' END) entry
WHERE d.preferred=1
 AND json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.scope.operation') IN ('publish','encrypt-publish')
 AND json_type(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.scope.kind')='integer' AND json_type(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.at')='integer'
 AND json_extract(CASE WHEN json_valid(entry.value) THEN entry.value ELSE '{}' END,'$.decision') IN ('allowed','automatic','denied');
--> statement-breakpoint
DROP TABLE napplet_merge_candidates;

--> statement-breakpoint
DROP TABLE napplet_known_versions;
