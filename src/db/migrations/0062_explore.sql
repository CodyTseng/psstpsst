CREATE TABLE explore_entries (
 account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
 source_id text NOT NULL, address text NOT NULL,title text NOT NULL,kind text NOT NULL,servers text NOT NULL DEFAULT '[]',manifest text,
 PRIMARY KEY(account_pubkey,source_id)
);
--> statement-breakpoint
CREATE TABLE explore_shortcuts (
 account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
 source_id text NOT NULL,position integer NOT NULL,PRIMARY KEY(account_pubkey,source_id)
);
--> statement-breakpoint
CREATE INDEX explore_shortcut_order ON explore_shortcuts(account_pubkey,position);
--> statement-breakpoint
CREATE TABLE explore_history (
 account_pubkey text NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
 source_id text NOT NULL,last_used_at integer NOT NULL,PRIMARY KEY(account_pubkey,source_id)
);
--> statement-breakpoint
CREATE INDEX explore_history_order ON explore_history(account_pubkey,last_used_at);
