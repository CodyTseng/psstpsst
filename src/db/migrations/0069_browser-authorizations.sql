CREATE TABLE browser_authorizations (
  account_pubkey TEXT NOT NULL REFERENCES accounts(pubkey) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny')),
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_pubkey, source_id, resource)
);
