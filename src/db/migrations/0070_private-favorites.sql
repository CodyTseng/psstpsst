CREATE TABLE private_list_sync_state_next (
 account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
 kind integer NOT NULL DEFAULT 30000,
 d_tag text NOT NULL,
 revision integer NOT NULL DEFAULT 0,
 dirty integer NOT NULL DEFAULT 0,
 event_id text,
 PRIMARY KEY(account_pubkey,kind,d_tag)
);
--> statement-breakpoint
INSERT INTO private_list_sync_state_next(account_pubkey,d_tag,revision,dirty,event_id)
 SELECT account_pubkey,d_tag,revision,dirty,event_id FROM private_list_sync_state;
--> statement-breakpoint
DROP TABLE private_list_sync_state;
--> statement-breakpoint
ALTER TABLE private_list_sync_state_next RENAME TO private_list_sync_state;
--> statement-breakpoint
ALTER TABLE explore_shortcuts ADD COLUMN reference text;
--> statement-breakpoint
INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag,revision,dirty)
 SELECT DISTINCT account_pubkey,30267,'psstpsst-favorites',1,1 FROM explore_shortcuts;
