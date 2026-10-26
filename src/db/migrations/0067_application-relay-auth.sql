-- Relay authentication decisions now cover all relays for one account and source.
-- Retain the newest active decision; prefer refusal when timestamps tie.
DELETE FROM signing_authorizations
WHERE operation = 'relay-auth' AND id NOT IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY account_pubkey, source_id
      ORDER BY updated_at DESC, CASE decision WHEN 'deny' THEN 0 ELSE 1 END, id DESC
    ) AS position
    FROM signing_authorizations
    WHERE operation = 'relay-auth' AND kind = 22242
      AND (expires_at IS NULL OR expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS integer))
  ) WHERE position = 1
);
--> statement-breakpoint
UPDATE signing_authorizations
SET destinations = '[]', d_tag = '', recipient = ''
WHERE operation = 'relay-auth';
