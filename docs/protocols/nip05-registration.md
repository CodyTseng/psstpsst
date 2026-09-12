# NIP-05 Registration (psstpsst.chat)

## Status and scope

PsstPsst runs its own NIP-05 naming service at `https://psstpsst.chat`. This
document covers the client-side registration flow; the lookup itself is plain
NIP-05. Deletion is not exposed in the app.

Names are 5-30 characters of lowercase letters, digits, `.`, `_`, `-`, and
must start and end with a letter or digit. Matching is case-insensitive; the
service stores lowercase. Reserved names are enforced only by the service.
Reverse lookup still accepts legacy registrations that predate the current
length and trailing-character rules so their owners can reuse them, while new
and renamed names follow the current rules.

## Endpoints

| Operation | Request | Success | Failure |
| --- | --- | --- | --- |
| Lookup | `GET /.well-known/nostr.json?name=<name>` | `200 {"names":{"alice":"<pubkey>"}}` (empty `names` when unregistered) | `400` missing param |
| Reverse lookup | `GET /.well-known/nostr.json?pubkey=<hex>` | `200 {"names":{"alice":"<pubkey>"}}` (same shape as the forward lookup; empty `names` when the key owns nothing) | `400` missing param |
| Availability | `GET /api/names/:name/availability` | `200` available | `400` invalid name, `403` reserved name, `409` taken by another key |
| Register / rename (upsert) | `PUT /api/names/:name` (no body) | `201 {name, pubkey}`, or `200 {name, pubkey}` if already owned | `400` invalid name, `401` unauthenticated, `403` reserved name, `409` taken by another key |
| Delete | `DELETE /api/names/:name` | `200 {"deleted":"<name>"}` | `401`, `403` not the owner, `404` unknown name |

A pubkey can own at most one name. PUT binds the requested name to the
NIP-98 event signer and automatically releases that key's previous name.
Repeating PUT for an already-owned name is a harmless no-op. A name owned by
another key cannot be claimed; only its owner can release it with DELETE.
The client never deletes or rolls back the previous name during a rename.

Mutations require a NIP-98 authorization header
(`Authorization: Nostr <base64(JSON event)>`): a kind `27235` event with a `u`
tag equal to the full request URL and a `method` tag matching the HTTP method,
`created_at` within 60 seconds of server time, and a valid schnorr signature.
PUT has no request body: the bound pubkey comes from the event signer, so a
name can never be claimed for someone else's key.

## Client flow

`src/services/nip05/nip05.service.ts` implements lookup, upsert, and delete
against these endpoints with per-request timeouts; failures surface as typed
`Nip05NameError` codes so the UI can distinguish "taken" from "couldn't check".

- Onboarding offers an optional, skippable claim step immediately after the
  key backup (`src/app/(onboarding)/nip05.tsx`), before the account bootstrap
  (`setActive`) runs. A successful claim is also published best-effort into
  the kind-0 profile's `nip05` field.
- The profile edit screen accepts any provider's full `<local-part>@<domain>`
  NIP-05 identifier. The local part is limited to `a-z`, `0-9`, `.`, `_`, and
  `-`. A reverse lookup changes its quiet supporting action: a key that owns a
  psstpsst.chat name can stage that identifier directly when another provider
  is in the field, or open `Nip05ClaimForm` to rename it when already selected.
  A key without a name opens the same sheet to register after a live
  availability check.
- User input resolution (`src/lib/nostr/user-input.ts`) completes a bare local
  part (no `@domain`) against `psstpsst.chat`, so searching `alice` resolves
  `alice@psstpsst.chat`. Full `name@domain` identifiers keep using their own
  provider's lookup.
