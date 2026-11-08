CREATE TABLE signing_authorizations_new (
  id integer PRIMARY KEY AUTOINCREMENT,
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id text NOT NULL,
  operation text NOT NULL DEFAULT 'publish',
  kind integer NOT NULL,
  scope_key text NOT NULL DEFAULT '',
  decision text NOT NULL CHECK(decision IN ('allow','deny','ask')),
  expires_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT signing_authorization_kind CHECK (
    (operation IN ('get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt') AND kind = -1)
    OR (operation NOT IN ('get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt') AND kind BETWEEN 0 AND 65535)
  )
);
--> statement-breakpoint
INSERT INTO signing_authorizations_new (id,account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at)
SELECT id,account_pubkey,source_id,operation,kind,scope_key,decision,expires_at,created_at,updated_at FROM signing_authorizations;
--> statement-breakpoint
DROP TABLE signing_authorizations;
--> statement-breakpoint
ALTER TABLE signing_authorizations_new RENAME TO signing_authorizations;
--> statement-breakpoint
CREATE UNIQUE INDEX signing_authorization_scope ON signing_authorizations(account_pubkey,source_id,operation,kind,scope_key);
--> statement-breakpoint
CREATE UNIQUE INDEX signing_relay_auth_scope ON signing_authorizations(account_pubkey,source_id,scope_key) WHERE operation='relay-auth';
--> statement-breakpoint
CREATE TABLE signing_preferences (
  account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id text NOT NULL,
  level text NOT NULL CHECK(level IN ('manual','routine','trusted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX signing_preference_source ON signing_preferences(account_pubkey,source_id);
