-- Convert Everyday use to ordinary editable grants before removing the legacy level.
CREATE TEMP TABLE everyday_sources AS
SELECT account_pubkey,source_id FROM app_authorization_preferences WHERE level='routine';
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'get-public-key',-1,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'nip04-encrypt',-1,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'nip44-encrypt',-1,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'relay-auth',22242,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',1,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',4,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',6,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',7,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',13,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',16,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT account_pubkey,source_id,'publish',1059,'','allow',NULL,CAST(strftime('%s','now') AS integer)*1000,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,operation,kind,scope_key) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
INSERT INTO browser_authorizations (account_pubkey,source_id,resource,decision,expires_at,updated_at)
SELECT account_pubkey,source_id,'webln-info','allow',NULL,CAST(strftime('%s','now') AS integer)*1000 FROM everyday_sources WHERE true
ON CONFLICT(account_pubkey,source_id,resource) DO UPDATE SET decision='allow',expires_at=NULL;
--> statement-breakpoint
CREATE TEMP TABLE everyday_access AS
SELECT s.account_pubkey,s.source_id AS app_key,'domains' AS key,
  (SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(COALESCE((SELECT value FROM napplet_data WHERE account_pubkey=s.account_pubkey AND app_key=s.source_id AND bucket='permissions' AND key='domains'),'[]'))
    UNION SELECT value FROM json_each('["shell","network","resource","storage","config","theme","ui","identity","common","relay","outbox"]')
  )) AS value FROM everyday_sources s
UNION ALL
SELECT s.account_pubkey,s.source_id,'denied-domains',
  (SELECT json_group_array(value) FROM json_each(COALESCE((SELECT value FROM napplet_data WHERE account_pubkey=s.account_pubkey AND app_key=s.source_id AND bucket='permissions' AND key='denied-domains'),'[]'))
    WHERE value NOT IN (SELECT value FROM json_each('["shell","network","resource","storage","config","theme","ui","identity","common","relay","outbox"]')))
FROM everyday_sources s;
--> statement-breakpoint
INSERT INTO napplet_data (account_pubkey,app_key,bucket,key,value,bytes)
SELECT account_pubkey,app_key,'permissions',key,value,length(CAST(key||value AS blob)) FROM everyday_access WHERE true
ON CONFLICT(account_pubkey,app_key,bucket,key) DO UPDATE SET value=excluded.value,bytes=excluded.bytes;
--> statement-breakpoint
INSERT INTO napplet_usage (account_pubkey,app_key,bucket,bytes,count)
SELECT d.account_pubkey,d.app_key,'permissions',SUM(d.bytes),COUNT(*) FROM napplet_data d
JOIN everyday_sources s ON d.account_pubkey=s.account_pubkey AND d.app_key=s.source_id
WHERE d.bucket='permissions' GROUP BY d.account_pubkey,d.app_key
ON CONFLICT(account_pubkey,app_key,bucket) DO UPDATE SET bytes=excluded.bytes,count=excluded.count;
--> statement-breakpoint
CREATE TABLE app_authorization_preferences_new (
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id text NOT NULL,
  fully_trusted integer NOT NULL DEFAULT 0 CHECK(fully_trusted IN (0,1))
);
--> statement-breakpoint
INSERT INTO app_authorization_preferences_new SELECT account_pubkey,source_id,level='trusted' FROM app_authorization_preferences;
--> statement-breakpoint
DROP TABLE app_authorization_preferences;
--> statement-breakpoint
ALTER TABLE app_authorization_preferences_new RENAME TO app_authorization_preferences;
--> statement-breakpoint
CREATE UNIQUE INDEX app_authorization_preference_source ON app_authorization_preferences(account_pubkey,source_id);
--> statement-breakpoint
DROP TABLE everyday_access;
--> statement-breakpoint
DROP TABLE everyday_sources;
