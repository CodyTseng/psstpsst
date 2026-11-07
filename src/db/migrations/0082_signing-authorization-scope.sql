-- Obsolete qualified grants must not become broader permissions when their columns disappear.
DELETE FROM signing_authorizations WHERE recipient <> '' OR destinations <> '[]';
--> statement-breakpoint
DROP INDEX signing_authorization_scope;
--> statement-breakpoint
ALTER TABLE signing_authorizations DROP COLUMN recipient;
--> statement-breakpoint
ALTER TABLE signing_authorizations DROP COLUMN destinations;
--> statement-breakpoint
CREATE UNIQUE INDEX signing_authorization_scope
ON signing_authorizations(account_pubkey, source_id, operation, kind, scope_key);
