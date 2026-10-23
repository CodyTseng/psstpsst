ALTER TABLE signing_authorizations RENAME COLUMN d_tag TO scope_key;
--> statement-breakpoint
CREATE UNIQUE INDEX signing_relay_auth_scope
ON signing_authorizations(account_pubkey, source_id, scope_key)
WHERE operation = 'relay-auth';
