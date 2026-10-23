-- Peer-bound rules require a new decision under the operation-wide scope.
DELETE FROM signing_authorizations
WHERE operation IN ('nip04-encrypt','nip04-decrypt','nip44-encrypt','nip44-decrypt')
  AND recipient <> '';
