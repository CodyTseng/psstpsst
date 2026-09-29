# NIP-05 Registration Implementation

PsstPsst uses the NIP-05 naming service at `https://psstpsst.chat`. Lookup uses
`GET /.well-known/nostr.json`; registration is a service-specific HTTP API, not
a PsstPsst messaging protocol.

Names are 5–30 characters of lowercase letters, digits, `.`, `_`, and `-`, and
must start and end with a letter or digit. Matching is case-insensitive and the
service stores lowercase. Legacy registrations remain discoverable by reverse
lookup even when they predate the current length or trailing-character rules.

## Service endpoints

| Operation | Request | Success | Failure |
| --- | --- | --- | --- |
| Lookup | `GET /.well-known/nostr.json?name=<name>` | `200 {"names":{"alice":"<pubkey>"}}`; empty `names` when absent | `400` missing parameter |
| Reverse lookup | `GET /.well-known/nostr.json?pubkey=<hex>` | Same response shape; empty `names` when absent | `400` missing parameter |
| Availability | `GET /api/names/:name/availability` | `200` available | `400` invalid, `403` reserved, `409` taken |
| Register or rename | `PUT /api/names/:name` with no body | `201 {name, pubkey}`, or `200` when already owned | `400`, `401`, `403`, `409` |
| Delete | `DELETE /api/names/:name` | `200 {"deleted":"<name>"}` | `401`, `403`, `404` |

A pubkey can own at most one name. `PUT` binds the requested name to the NIP-98
signer and releases that key's previous name. Repeating a `PUT` for an already
owned name is a no-op. A name owned by another key cannot be claimed.

Mutations use `Authorization: Nostr <base64(JSON event)>` with a kind `27235`
NIP-98 event. Its `u` tag is the full request URL, its `method` tag matches the
HTTP method, `created_at` is within 60 seconds of server time, and its Schnorr
signature is valid. `PUT` has no body; the bound pubkey comes from the signer.

## Client behavior

`src/services/nip05/nip05.service.ts` implements lookup, upsert, and delete
with per-request timeouts. Typed `Nip05NameError` values let the UI distinguish
an unavailable name from a failed availability check. The app does not expose
deletion.

Onboarding offers an optional claim step after key backup and before account
bootstrap. After a successful claim, the client makes a best-effort update to
the kind-0 profile's `nip05` field.

The profile editor accepts any provider's complete `<local-part>@<domain>`
identifier. A reverse lookup decides whether to offer registration, rename, or
selection of an existing `psstpsst.chat` name. User-input resolution completes
a bare local part against `psstpsst.chat`; complete identifiers continue to use
their own provider.
