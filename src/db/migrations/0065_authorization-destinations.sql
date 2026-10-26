ALTER TABLE signing_authorizations ADD COLUMN destinations text NOT NULL DEFAULT '[]';
--> statement-breakpoint
DROP INDEX signing_authorization_scope;
--> statement-breakpoint
CREATE UNIQUE INDEX signing_authorization_scope ON signing_authorizations(account_pubkey, source_id, operation, kind, d_tag, recipient, destinations);
