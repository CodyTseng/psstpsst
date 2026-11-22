# Group messaging implementation

See [NIP-17 extensions](../protocols/nip17-extensions.md) for group event
formats, membership and name state, and the saved-group snapshot. This note
covers local lifecycle and policy decisions that affect maintenance.

## Identity and authorization

The account-scoped conversation key is `group:<sha256(UTF-8(group-id))>`.
Store the raw ID separately for outbound rumors and private snapshots. Pass
group destinations through the shared conversation target all the way to
send admission. Treating a group conversation key as a peer public key breaks
delivery, imports, and notifications.

Before the first text or file send, a locally created group's roster and name
are draft state. Edits produce no remote action. The first send freezes that
state into the rumor. Abandoning the unbootstrapped group removes the local
draft and its staged files after cancellation.

Ordinary content, reactions, and renames authorize against the current roster.
Membership actions replay from the bootstrap baseline against the roster at
their ordered position. Replay may deactivate an action's roster effect.
Already visible messages and action rows keep their timeline position and
never alert again because of replay. Name state has its own latest-event cursor.
Removal of the local member makes send paths read-only and preserves the draft.
Already admitted work keeps its frozen audience. A newer invite can restore
writing.

## Intake and finality

Authenticate and validate addressing before quarantine or storage. A self copy
can omit the local author from its audience. Drop future-dated inner rumors
using the shared intake rule. Keep pre-bootstrap candidates in a separate
bounded quarantine so ordinary history reads stay free of pending-state checks.
After bootstrap, revalidate candidates against the initialized roster. A
non-current author of an ordinary message is an authorization failure.

While history coverage is incomplete, preserve out-of-order membership action
replay. After backward coverage is complete, reject newly discovered network
actions in the finalized range. Use the conservative coverage across configured
relays and leave the boundary second open. Established group content may still
arrive late, but a finalized late subject cannot replace the name. Local sends
and explicit archive imports bypass network finality. Persist original arrival
eligibility with quarantined rumors so promotion does not turn backfill into a
live alert.

## Requests and saved groups

A blocked sender cannot bootstrap a new group. An existing group still shows
valid activity from members who are blocked in one-to-one conversations.
Resolve Requests at the conversation level. Bootstrap by a saved contact,
local activity, or explicit saving can accept the group. Later remote authors
do not promote an established request.

Established groups soft-delete at a strict message-time boundary. A newer
visible rumor can restore the conversation. Replaying known history cannot.
Deleting a conversation or being removed preserves saved membership. An
explicit local leave removes it. The saved set and contacts share atomic
snapshot revisions. See [configuration publication](configuration-publication.md).

## Delivery and verification

Group send uses the same [durable relay delivery queue](relay-message-delivery.md)
as direct send, with a frozen audience and a self copy. Admission commits any
local roster or name change with the outgoing action and queue job. Delivery
failure leaves that committed local state in place. Keep roster resolution and
title/avatar derivation bounded so UI work does not grow with history size.

- [Group services and tests](../../src/services/group/) cover authorization,
  replay, quarantine, and local lifecycle.
- [Protocol helpers and tests](../../src/lib/nostr/) cover event parsing and
  chronology.
- [Database tests](../../src/db/__tests__/) cover upgrades and durable state.
