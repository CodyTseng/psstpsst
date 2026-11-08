ALTER TABLE signing_preferences RENAME TO app_authorization_preferences;
--> statement-breakpoint
DROP INDEX signing_preference_source;
--> statement-breakpoint
CREATE UNIQUE INDEX app_authorization_preference_source ON app_authorization_preferences(account_pubkey,source_id);
