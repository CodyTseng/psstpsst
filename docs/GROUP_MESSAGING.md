# Group Messaging Implementation Plan

> Status: **approved design, not yet implemented**.
>
> This is an implementation plan, not a protocol specification. Group messaging
> deliberately extends NIP-17 room semantics and therefore lives outside
> `docs/protocols/`.

## 1. Scope and trust model

PsstPsst groups are intended for small circles of trusted people such as family
and close friends. They use ordinary NIP-17 kind-14, kind-15, and kind-7 rumors,
with the existing seal and gift-wrap delivery pipeline.

The design has:

- no administrator role;
- no shared group key;
- no group-level block in v1;
- no history delivery to newly added members;
- no hard member limit.

Every current member is trusted to publish an accurate member snapshot and group
name. The implementation prevents an author who is not a current member from
changing an existing group, but it does not attempt Byzantine consensus or
protect a trusted member from deliberately publishing false state.

This is only partially interoperable with generic NIP-17 clients. The encrypted
messages, `p` tags, and `subject` tags remain readable, but PsstPsst uses a stable
`h` identity across member changes. Standard NIP-17 instead treats a changed
`pubkey + p` set as a new room. A foreign client may therefore split one
PsstPsst group into several rooms, and a reply that omits `h` cannot return to
the stable PsstPsst group.

## 2. Group identity

A group rumor carries an `h` tag:

```text
["h", "<group-id>"]
```

The receiver uses the value of the first `h` tag and stops scanning for further
`h` tags. A first `h` tag without a usable value does not identify a group.
There is no additional format restriction on received group ids.

PsstPsst generates its own group ids as 32 cryptographically random bytes
encoded as 64 lowercase hexadecimal characters. The value looks like a pubkey
but is not a key and has no corresponding private key.

Raw group ids may contain characters that are unsafe in routes or cache keys.
The internal conversation key is therefore:

```text
group:<sha256(UTF-8(group-id))>
```

The raw value remains in `conversations.group_id` and is written back to the `h`
tag when sending. Account scoping remains part of every database key.

Two separately generated groups are distinct even when their members are
identical.

## 3. One event ordering rule

Before group messaging, consolidate all message and cursor comparisons behind
one shared event-order helper.

`orderAt` remains the normalized authenticated message timestamp:

```text
orderAt = created_at * 1000 + valid-ms-tag
```

An absent or malformed `ms` tag contributes zero milliseconds.

Event recency follows the same tie-break direction as NIP-01 replaceable-event
selection:

- a larger `orderAt` is newer;
- at an equal `orderAt`, the lexicographically smaller event id is newer.

Consequently, chronological oldest-to-newest SQL ordering is:

```sql
ORDER BY order_at ASC, id DESC
```

This rule must be shared by message pagination, last-message cursors, read
cursors, unread queries, notification recovery, warm-tail merging, imports, and
group-state comparison. The supporting SQLite index must use the corresponding
mixed directions.

All decrypted chat rumors, including direct messages, groups, reactions, and
Nearby messages, are dropped when `created_at` is more than ten minutes ahead of
the local clock. The check applies to the inner rumor, never to the randomized
seal or gift-wrap timestamps. Future-dated rumors are not quarantined for later.

## 4. Member snapshots

For an ordinary group kind-14 or kind-15 rumor, the claimed member snapshot is:

```text
author ∪ p-tag pubkeys
```

Pubkeys are deduplicated and stored in lexicographic order.

The first valid kind-14 or kind-15 rumor seen for an unknown `h` creates the
local group view. No `create` action is required. The initial members are the
rumor author and its `p` tags.

For an existing group:

1. The author must be in the locally cached current member snapshot.
2. A valid event is stored as a message.
3. Its member snapshot replaces the cached snapshot only when the event is newer
   than the cached member cursor.
4. An older or backfilled message never rolls current state backward.

A current member may therefore add or omit pubkeys through an ordinary message.
Those changes are accepted silently. Explicit actions exist for presentable UI
changes and for removal, whose notification audience differs from its resulting
member snapshot.

This deliberately uses current local membership for authorization rather than
reconstructing whether the author was a member at the event's historical time.
As a result, a very late message from someone who has since been removed may be
dropped. That tradeoff keeps state tracking incremental and is accepted by the
trusted-small-group model.

Reactions use the same group authorization, fan-out, and quarantine pipeline as
kind-14/15 rumors, but kind 7 never changes members or the group name.

## 5. Group name

Member state and name state have independent LWW cursors.

For a valid current-member kind-14 or kind-15 rumor:

- no `subject` tag preserves the current name;
- `["subject"]` clears the custom name;
- `["subject", ""]` clears the custom name;
- a non-empty subject sets the custom name.

A subject changes the cached name only when its event is newer than the cached
name cursor. Older or backfilled subjects never roll the current name backward.

PsstPsst emits `subject` when it intentionally communicates name state, notably
for rename and for an invite into an already named group. Ordinary messages do
not need to repeat an unchanged subject. A foreign client's valid group message
may still change the name by carrying a subject.

When no custom name exists, the title is derived from all current members,
including the local user. Member display names and avatar candidates are ordered
by pubkey. The member list does not add a special "you" label.

## 6. Action messages

Actions are ordinary kind-14 group rumors with empty content and one recognized
`action` tag. They are stored in `messages` and rendered as system lines rather
than chat bubbles.

Only three actions exist:

```text
["action", "invite", "<target-pubkey>"]
["action", "remove", "<target-pubkey>"]
["action", "rename"]
```

There is no `create` action and no separate `leave` action.

### Invite

An invite has exactly one target. The target must appear in the rumor's `p`
tags. The resulting member snapshot is the normal `author ∪ p` snapshot.
Other snapshot differences are trusted and accepted.

When the group has a custom name, PsstPsst includes its current `subject` so a
new member can initialize the name. An invite does not overwrite an existing
member's newer cached name. A concurrent rename may leave the invitee with a
temporarily stale name until a later rename; v1 accepts this.

### Remove and leave

Remove has exactly one target, which must be a current member.

The resulting snapshot is:

```text
(author ∪ p-tag pubkeys) - target
```

When target differs from author, target must remain in `p` so that the removed
member receives the removal notice. When target equals author, the action means
leave; the sender's self copy preserves the action locally.

The UI renders these cases differently:

- `A removed B` when target differs from author;
- `A left the group` when target equals author.

### Rename

Rename requires a subject tag. A non-empty trimmed value sets the name; an
empty or value-less subject clears it. Names are limited to 80 characters.
Its `author ∪ p` snapshot follows the ordinary member-snapshot rule.

### Presentation

Invite, remove, and rename:

- render as localized system lines;
- appear as localized conversation-list previews;
- count as unread when authored by someone else outside the active group;
- may create a notification under the existing notification privacy settings;
- cannot be replied to, quoted, or reacted to.

## 7. Receiving and quarantine

The receive path remains incremental:

1. Verify and decrypt the NIP-17 envelope through the existing pipeline.
2. Drop an inner rumor dated more than ten minutes in the future.
3. Read the first `h` tag. Without a usable value, retain current direct-message
   behavior.
4. Derive the hashed group conversation key.
5. For an unknown group, allow the first kind-14/15 rumor to initialize it.
6. For an existing group, accept a current member's rumor and update the cached
   member and name registers independently when their cursors advance.
7. Quarantine a rumor from a non-current author rather than immediately dropping
   it; an earlier-delivered snapshot may still add that author.
8. After a member update, revalidate relevant quarantined rumors.
9. Once history recovery confirms coverage before a quarantined rumor and its
   author is still not a member, delete it permanently.

The quarantine uses a separate table so every hot message query does not need a
pending-state predicate:

```text
pending_group_rumors
- account_pubkey
- group_id
- message_id
- order_at
- sender_pubkey
- rumor
- source_relays
- pending_reason
- received_at
```

Indexes:

```text
PRIMARY KEY (account_pubkey, message_id)
INDEX (account_pubkey, group_id, order_at ASC, message_id DESC)
```

Bound the quarantine to 256 ordinary rumors per group and 2,048 per account.
When necessary, discard the oldest ordinary quarantined rumors first. Candidate
member actions are retained ahead of ordinary chat rumors.

An existing group is treated as one conversation even when it contains a
person blocked in one-to-one messaging. Messages and actions from that person
remain visible and notify normally inside the group. A blocked person cannot
bypass the block by creating or inviting the user into a previously unseen
group; such a new-group rumor is rejected. Group-level blocking is out of scope
for v1.

### Requests

For a previously unseen group:

- a first author who is a saved contact routes the group to the main inbox;
- another author routes it to Requests;
- replying reuses `hasReplied` to accept the group;
- a blocked first author is rejected.

Subsequent authors do not independently re-gate an already accepted group.

## 8. Persistence

### Conversations

Add these columns to `conversations`:

```text
group_id
member_pubkeys
members_order_at
members_event_id
name_order_at
name_event_id
```

`group_id = null` continues to identify non-group conversations. The existing
`name` column caches the current custom group name. Member and name registers
advance independently using the shared event comparator.

There is no group-state event table. Full rumors remain in `messages`; current
state is the two cached LWW registers above. Import and rebuild paths process
rumors using the same comparator and incremental rules.

### Messages

The `messages` table remains unchanged. Its stored tags and rumor JSON already
contain `h`, `p`, `subject`, and `action`. Bubble-versus-system presentation is
derived from the action tag.

### Per-recipient outbox

Keep the existing `outbox` row as the message-level aggregate and add a child
table for independently retryable copies:

```text
outbox_copies
- account_pubkey
- message_id
- recipient_pubkey
- self
- status
- attempts
- next_attempt_at
- last_error
- gift_wrap
- relay_urls
- updated_at
```

Primary key:

```text
(account_pubkey, message_id, recipient_pubkey)
```

The single-recipient direct-message path must use the same abstraction; it is
the one-recipient case of the group pipeline, not a separate implementation.
Relay delivery retains the current manual-retry behavior rather than adding a
new automatic retry policy.

Extend each persisted `message_deliveries.copies` item with a copy-level status
and error. This must represent failures before wrapping, such as a missing
encryption key or DM relay, as well as per-relay publish results.

Message aggregate status is derived from recipient copies:

- all recipient copies delivered: `sent`;
- some delivered: `partial`;
- none delivered: `failed`.

The self copy is excluded from this aggregate. It is shown separately as
delivery to the user's other devices and remains independently retryable.

## 9. Sending

For a group send, capture the current member snapshot and address every member
except the author in sorted pubkey order. Include the raw group id in `h` and
the recipients in `p`. One immutable rumor is wrapped once per recipient plus
once for the sender's own inbox, so a group of N members produces N copies.

Recipient metadata lookup and delivery degrade independently. A missing key,
missing inbox relay, or publish failure for one member does not block copies for
other members.

Performance rules:

- resolve recipient encryption keys and relay lists with bounded parallelism;
- optimistically store and render the message before CPU-heavy wrapping;
- generate gift wraps in small chunks and yield to a macrotask between chunks;
- persist each generated copy immediately in `outbox_copies`;
- never rebuild or resend an already successful recipient copy during another
  recipient's retry.

The message-detail screen retries one selected recipient or self copy. The
shared direct/group retry service rebuilds a gift wrap only when the failed
copy never had a durable payload; otherwise it republishes the durable payload
where protocol rules permit.

Attachments retain the existing efficient shape: encrypt and upload ciphertext
once, then carry the same key and nonce inside every recipient's encrypted
rumor. Network media upload cost does not multiply with member count.

Reactions and forwards use the same group authorization and per-recipient
fan-out pipeline. Reactions do not produce member or name state.

## 10. Large-group guidance

There is no hard member cap. When initial creation or a later invite would
result in more than eight members, show a confirmation warning and let the user
continue.

The localized copy should use plain language equivalent to:

> Each message has to be encrypted and sent separately for every person in the
> group. Larger groups may send more slowly, and some people may receive
> messages later. Continue?

Do not expose protocol terms such as gift wrap, relay fan-out, or NIP-17 in this
product warning.

## 11. UI

Read `docs/DESIGN.md`, especially section 12, before implementation.

### Creation and management

- The new-chat flow opens the existing multi-select contact picker.
- Generate the group id as soon as selection completes so drafts, attachments,
  file handoff, and routing have a stable `group:<hash>` key.
- Before the first send, persist only local draft state; do not insert a formal
  conversation row.
- The first sent kind-14 or kind-15 rumor creates the conversation. It has no
  special create action.
- The group-info screen lists members and supports inviting one person,
  renaming, removing another member, and leaving through remove-self.
- After the local user is removed, retain readable history and replace the
  composer with a plain-language explanation.

### Conversation presentation

- Add a centered system-row presentation for invite, remove/leave, and rename.
- Show sender labels on group bubbles only.
- Use the custom name when present; otherwise join every current member's
  resolved name in pubkey order, including the local user.
- Build the avatar collage from the first two to four members in the same
  stable pubkey order.
- Keep list and header names single-line and truncatable under the existing
  design rules.

### Delivery presentation

Do not put a numeric delivery fraction beside the bubble timestamp. The current
fixed-width status slot prevents layout shifts and must stay fixed-width:

- pending uses the existing pending glyph;
- all members delivered uses the success glyph;
- partial delivery uses a fixed-size warning glyph;
- all failed uses the danger glyph.

The message-detail screen shows a member count such as `7/11`, followed by one
row per recipient with expandable relay results and a recipient-specific retry
action. Show the self copy separately as delivery to the user's other devices.

### Notifications

When privacy preferences permit, a group notification uses the group name as
the title and `Sender: message preview` as the body. Actions use localized
system text. The existing independent sender-information and message-content
privacy settings still control what is exposed.

Add a `group.*` i18n namespace in every supported locale and retain parity-test
coverage.

## 12. Conversation identity audit

Group support invalidates the assumption that a relay `conversation_key` is
always a peer pubkey. Audit and update every such call site, including:

- composer recipient selection;
- chat header and profile navigation;
- notification filtering and previews;
- conversation preferences, mute, delete, and request handling;
- contact/profile joins in lists and search;
- share and forward targets;
- reaction and reply helpers;
- route parsing and wide-pane selection;
- archive import/export and rebuild paths;
- caches keyed by conversation identity.

UI code continues to read through hooks and stores. Services own state changes,
and core layers remain platform-free.

## 13. Suggested implementation order

Each phase should leave direct messaging working and have focused tests before
the next phase begins.

1. **Unified event ordering**
   - shared comparator and cursor predicates;
   - mixed-direction SQLite indexes;
   - message pagination, last/read cursors, unread, notification recovery, and
     cache tests.
2. **Group identity and pure helpers**
   - first-`h` parsing;
   - hashed conversation keys;
   - normalized member and subject snapshots;
   - action parsing and validation.
3. **Persistence migration**
   - conversation group registers;
   - `pending_group_rumors`;
   - `outbox_copies`;
   - extended delivery-copy types.
4. **Receive path**
   - first-message initialization;
   - current-member authorization;
   - independent member/name LWW updates;
   - quarantine and history-coverage cleanup;
   - Requests, personal-block boundary, unread, and notifications.
5. **Unified delivery refactor**
   - direct messaging as the one-recipient copy pipeline;
   - per-copy wrapping, persistence, publication, status, and manual retry;
   - partial aggregate status.
6. **Group send path**
   - snapshot recipients;
   - bounded parallel metadata lookup;
   - chunked wrapping and per-copy durable writes;
   - attachments, reactions, and forwards.
7. **Conversation identity audit**
   - remove every remaining peer-pubkey assumption.
8. **UI and localization**
   - creation, group info, system rows, sender labels, titles, avatars,
     notifications, delivery details, and large-group warnings.
9. **Architecture and verification**
   - update `docs/ARCHITECTURE.md` after implementation;
   - run unit, integration, migration, i18n, and UI tests;
   - verify light/dark themes, RTL, dynamic text, and large histories.

## 14. Required tests

At minimum, cover:

- first-`h` parsing and arbitrary group-id hashing;
- shared event comparison, including equal `orderAt` with lower id newer;
- ten-minute future rejection for direct, group, reaction, file, and Nearby
  rumors;
- first-message group initialization;
- ordinary member snapshot additions and omissions;
- independent subject preserve, set, and clear behavior;
- invite, remove-other, remove-self, and rename presentation;
- non-member quarantine, later acceptance, recovery-confirmed deletion, and
  quarantine caps;
- older/backfilled messages never rolling current state backward;
- personal blocks inside existing groups and blocked new-group authors;
- contact versus Requests routing;
- direct and group per-copy delivery, partial success, self-copy separation,
  persistence, restart recovery, and recipient-specific retry;
- attachment upload-once behavior;
- group reactions and forwards;
- conversation-key assumption audits;
- large-group warning without a hard cap;
- notification privacy combinations;
- i18n parity, RTL, light/dark themes, and stable bubble metadata width.

## 15. Explicitly out of scope for v1

- Standard NIP-17 room identity across membership changes.
- Administrators, roles, quorum, consensus, or malicious-member resistance.
- Group-level blocking.
- History delivery to new members.
- Read receipts.
- Automatic relay retry beyond the existing direct-message behavior.
- A hard member limit.
