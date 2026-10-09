# Group Messaging Implementation

> Status: **implemented**.
>
> This document records implementation details and product behavior.
> The event-format extensions are specified in
> [PsstPsst NIP-17 Extensions](../protocols/nip17-extensions.md).

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

Every current member is trusted to choose additions and publish accurate group
names and actions. The implementation prevents an author who is not a current
member from changing an existing group, but it does not attempt Byzantine
consensus or protect against a trusted member's deliberate false state.

This is only partially interoperable with generic NIP-17 clients. The encrypted
messages, `p` tags, and `subject` tags remain readable, but PsstPsst uses a stable
`h` identity and explicit membership actions. Standard NIP-17 instead treats a
changed `pubkey + p` set as a new room. A foreign client may therefore split one
PsstPsst group into several rooms, and a reply that omits `h` cannot return to
the stable PsstPsst group. A foreign client's plain-message `p` changes only
that message's delivery audience; they do not change PsstPsst membership.

## 2. Group identity

A group rumor carries an `h` tag:

```text
["h", "<group-id>"]
```

The receiver uses the value of the first `h` tag and stops scanning for further
`h` tags. A first `h` tag without a usable value does not identify a group.
Received group ids have no character-format restriction, but their UTF-8
encoding must be between 1 and 256 bytes. Reject an empty or oversized first
`h` value before hashing, persistence, quarantine, or route/cache use.

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

Current `master` already provides the shared `message-order` helper, updates
message pagination, notification ordering, warm-tail merging, and last-message
selection, and installs the mixed-direction message indexes in migration 0047.
Group state must reuse that helper rather than introduce another comparator.

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

Newest-to-oldest queries use the inverse mixed direction:

```sql
ORDER BY order_at DESC, id ASC
```

This rule remains authoritative for read cursors, unread queries, imports, and
all new group-state comparison.

Migration 0047 already repaired last-message cursors and indexes. Add one
follow-up migration for the state it did not repair:

- for an existing read cursor, advance it to the minimum event id at its current
  `orderAt`, treating every message in that same millisecond as read rather than
  manufacturing unread messages during upgrade;
- recompute unread counts from the repaired cursor.

Run this as set-based, indexed SQL. Do not load or sort complete conversation
histories in JavaScript; histories may contain millions of messages.

Membership actions replay in shared event order while account history is still
being covered. Once the account's full backward history sync completes, its
persisted forward sync cursor becomes an action-finality boundary. A network
action first seen after that boundary was persisted is dropped when its
authenticated inner timestamp is in the already-covered range. This applies to
`create`, `invite`, `remove`, and `rename`, and drops the entire rumor even when
a `create` also carries ordinary message content. The cursor has whole-second
precision, so its boundary second remains open until a later completed forward
pass covers it.

The finality rule is account-scoped because history sync covers every gift wrap
addressed to that account. It starts only when `backward_until = 0`; a partial
backfill establishes no finality. Local sends and explicit archive import are
trusted inputs and bypass this network late-action check. An ordinary group
message first seen late remains visible, but its `subject` cannot mutate group
name state when its inner timestamp is already finalized.

All decrypted chat rumors, including direct messages, groups, reactions, and
Nearby messages, are dropped when `created_at` is more than ten minutes ahead of
the local clock. The check applies to the inner rumor, never to the randomized
seal or gift-wrap timestamps. Future-dated rumors are not quarantined for later.

## 4. Group membership

The first sent kind-14 or kind-15 group rumor carries a `create` action. It
remains the user's first text or file message, not a separate system message.
For a previously unseen group, a valid `create` or `invite` action initializes
the local roster from `author ∪ p-tag pubkeys`. A plain message's `p` tags never
change membership. Bootstrap members are deduplicated and stored in
lexicographic pubkey order.

A valid member or recipient pubkey is exactly 64 lowercase hexadecimal
characters. Filter malformed incoming `p` values before addressing checks,
bootstrap, deduplication, persistence, or metadata lookup. Ordinary messages
ignore malformed `p` values. A membership action with a malformed target is
invalid; a bootstrap action is rejected when the filtered `p` values no longer
include the local account. Outgoing code emits only normalized valid pubkeys.

Before a locally created group has a bootstrap event, membership and name edits
are local conversation-draft mutations rather than protocol actions. Inviting
or removing edits the cached initial roster, rename edits the cached name, and
leaving abandons the unsent group by deleting its local conversation and draft
state. These local edits preserve the conversation's creation and updated times.
No system rows or network events are produced. The first text or file send
freezes that final local state into `create`, `p`, and `subject`.

For an existing group:

1. Incoming rumors from another author require that author to be in the locally
   cached current member snapshot. Own authored ordinary messages use the same
   requirement; removal makes the group read-only locally.
2. A valid event is stored as a message.
3. Plain-message `p` tags never change the cached roster. Only a valid `invite`
   or `remove` action changes membership after creation.
4. A removed member can return only through a newer `invite` action. A stale
   sender's later plain message cannot undo a removal, even if it names that
   member in `p`.

An author's `p` tags may differ from the local roster due to delayed delivery or
a different client. Outside a valid bootstrap action, this affects only who
receives that event. Explicit actions provide presentable UI changes and let
removal notices reach their target without keeping that target in the resulting
membership.

Ordinary messages deliberately use current local membership for authorization,
so a very late message from someone since removed may be dropped. Membership
actions instead evaluate the author against the roster at the action's position
in the ordered action history. This keeps ordinary-message intake incremental
while making membership state converge after out-of-order action delivery.

Reactions use the same group authorization, fan-out, and quarantine pipeline as
kind-14/15 rumors, but kind 7 never changes members or the group name. A removed
author's reaction is rejected like their ordinary message.

## 5. Group name

Explicit member actions and name state have independent cursors.

Rename is not part of membership-action replay. Once a rename passes the normal
receive-time authorization, later membership replay does not invalidate it.
Among accepted name events, the shared event comparator alone selects the
newest value.

For a valid current-member kind-14 or kind-15 rumor:

- no `subject` tag preserves the current name;
- `["subject"]` clears the custom name;
- `["subject", ""]` clears the custom name;
- otherwise trim Unicode whitespace from the first subject value;
- a trimmed empty value clears the custom name;
- a value of 1–80 Unicode code points sets the trimmed custom name;
- an overlong value on an ordinary message, `create`, or `invite` is ignored for
  name state while the rest of the rumor continues normally.

A subject changes the cached name only when its event is newer than the cached
name cursor. Older or backfilled subjects never roll the current name backward.

PsstPsst emits `subject` when it intentionally communicates name state, notably
for rename and for an invite into an already named group. Ordinary messages do
not need to repeat an unchanged subject. A foreign client's valid group message
may still change the name by carrying a subject.

When no custom name exists, derive the title from the current roster, including
the local user while still a member. Order members by pubkey, resolve at most the
first three display names for the title, and append localized copy equivalent to
`and N others` when members remain. Do not build or resolve an all-member title
string. Avatar candidates use the same stable pubkey order. The member list does
not add a special "you" label.

## 6. Action messages

Group actions are authenticated tags inside ordinary group rumors. Four actions
exist:

```text
["action", "create"]
["action", "invite", "<target-pubkey>"]
["action", "remove", "<target-pubkey>"]
["action", "rename"]
```

Only the first `action` tag is significant; ignore every later `action` tag.
With no `action` tag, process the rumor as an ordinary message. When the first
tag exists, it must exactly match one supported shape above, including its
arity, or the entire rumor is dropped before storage, quarantine, notification,
or state changes. A malformed or unknown first action cannot fall back to an
ordinary message, even when the rumor has text or file content.

`create` is allowed only on the first kind-14 or kind-15 text or file message.
Its `p` tags list every initial member except the author. The message retains
its ordinary bubble presentation and content. A `create` received after a newer
invite bootstrap may be stored as historical content without changing the
roster. A `create` newer than an existing bootstrap cursor is rejected as a
whole rumor rather than stored as an ordinary message, and it cannot
reinitialize a known group.

`invite` addresses every current member except the author plus its target in
`p`, so a newly invited recipient can initialize the group without receiving
its earlier history. For an existing group, only the explicit target action
governs membership; its `p` tags are not a replacement snapshot. Neither a
plain message nor a lone `p` tag changes membership. There is no separate
`leave` action.

The invitee deliberately trusts the inviter's current roster snapshot. If the
inviter previously missed a membership action, the invitee may bootstrap a
stale roster. Later actions apply normally, but omitted pre-bootstrap changes do
not repair themselves. V1 accepts this consequence of having no history
delivery, administrator, or consensus protocol.

Invite, remove, and rename are kind-14 rumors with empty content. They are
stored in `messages` and rendered as system lines rather than chat bubbles.

### Invite

An invite has exactly one target. The target must appear in the rumor's `p`
tags. During ordered replay, an authorized invite adds its target. For a known
group, its other `p` values do not change membership.

When the group has a custom name, PsstPsst includes its current `subject` so a
new member can initialize the name. An invite does not overwrite an existing
member's newer cached name. A concurrent rename may leave the invitee with a
temporarily stale name until a later rename; v1 accepts this.

### Remove and leave

Remove has exactly one target. The sender UI offers removal only for a current
member. A receiver records the action even if the target is not yet in its
cached roster, because their addition may arrive later. During ordered replay,
an authorized remove deletes its target. Its `p` tags cannot add anyone back to
the group.

When target differs from author, target must remain in `p` so that the removed
member receives the removal notice. When target equals author, the action means
leave; the sender's self copy preserves the action locally.

The UI renders these cases differently:

- `A removed B` when target differs from author;
- `A left the group` when target equals author.

### Rename

Rename requires a subject tag. A non-empty trimmed value sets the name; an
empty or value-less subject clears it. Names are limited to 80 Unicode code
points after trimming. An overlong rename makes the entire action invalid. Its
`p` tags affect delivery only.

The system capsule and conversation-list preview include the resulting name for
a set operation, using localized copy equivalent to `A renamed the group to X`.
A clear operation uses explicit localized copy equivalent to `A cleared the
group name`. Full rename text appears in a notification only when both sender
identity and message-content previews are enabled.

### Presentation

Invite, remove, and rename:

- render as localized system lines;
- appear as localized conversation-list previews;
- follow ordinary-message rules for conversation unread state, the main-inbox
  aggregate, application badges, and OS notifications;
- do not enter full-text message search because their visible text is derived
  and localized at render time;
- cannot be selected, copied, replied to, quoted, reacted to, or forwarded.

An own authored invite, remove/leave, or rename system capsule reserves the same
fixed-size delivery-status slot used by message metadata and shows queued,
sent, partial, or failed with the existing glyphs. Tapping the capsule opens the
same frozen-recipient delivery detail and retry flow as an ordinary message.
Incoming action capsules have no delivery slot; tapping one opens group info.

## 7. Receiving and quarantine

The receive path remains incremental:

1. Verify and decrypt the NIP-17 envelope through the existing pipeline.
2. Drop an inner rumor dated more than ten minutes in the future.
3. Read the first `h` tag. Without a usable value, retain current direct-message
   behavior.
4. Drop an incoming group rumor from another author unless its `p` tags include
   the local account. Own authored rumors are exempt because the sender's self
   copy need not include them in `p`. This applies to both unknown and existing
   groups, including actions and reactions, before quarantine or storage.
5. Derive the hashed group conversation key.
6. For an unknown group, initialize only from a valid `create` or `invite`
   action. Its author and `p` pubkeys form the initial roster; the local account
   must be in that roster. Quarantine ordinary rumors and other actions until
   such a bootstrap action arrives. Save it as the roster baseline.
7. For an existing group, accept an ordinary rumor, reaction, or rename/name
   event only from a current member; drop it immediately otherwise, including
   an own authored self copy after local removal. Insert structurally valid
   membership actions into the ordered action history and replay from the
   bootstrap baseline; each action's
   author must be a member at that position. Actions older than the bootstrap
   baseline remain historical and cannot change it. Ignore `p` differences for
   membership after bootstrap; reject a new `create` after the baseline. Apply
   accepted rename/name events through their independent latest-event cursor;
   membership replay never rolls them back.
8. Quarantine pre-bootstrap ordinary rumors while group membership is unknown.
   After bootstrap, a non-current author is an authorization failure rather than
   a delayed-membership candidate.
9. After an accepted bootstrap, revalidate its pre-bootstrap quarantine and
   discard entries whose authors are not in the initialized roster.

Removing the local account does not delete or hide the group. If a current
member's later rumor is still addressed to the local account, store and present
it normally. Local removal makes every send path read-only until a newer
`invite` restores membership. Receiving a message does not restore membership.
The service layer is the final send-authorization gate; UI state alone is not
sufficient. Incoming ordinary messages, reactions, and name events from removed
authors are dropped even when they address the local account.

Local removal does not delete an unsent composer draft. Hide the composer and
retain its text and other unsent draft metadata while the group is read-only; a
later valid invite restores the composer with that draft. Sends admitted before
removal continue through their frozen outbox pipeline, while attempts not yet
admitted fail the service-layer membership check.

The quarantine uses a separate table so every hot message query does not need a
pending-state predicate:

```text
pending_group_rumors
- account_pubkey
- conversation_key
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
INDEX (account_pubkey, conversation_key, order_at ASC, message_id DESC)
```

Bound the quarantine to 256 total entries per group and 2,048 per account. These
bounds include pre-bootstrap ordinary rumors and never-applied bootstrap or
membership-action candidates. When necessary, discard the oldest ordinary
quarantined rumors first. If only candidate actions remain at a cap, evict the
oldest candidates to keep the bound absolute. An evicted action is not
recoverable merely because an earlier action later makes it valid; this accepted
tradeoff bounds a rare, low-impact case. History coverage alone never deletes a
quarantined rumor until the account's backward history sync completes. When
that sync first establishes finality, delete still-invalid action candidates
and pre-bootstrap ordinary rumors whose inner timestamps are now in the final
covered range; later network actions in that range cannot make them valid.

An existing group is treated as one conversation even when it contains a
person blocked in one-to-one messaging. Messages and actions from that person
remain visible inside the group and follow normal unread and notification rules.
A blocked person cannot
bypass the block by creating or inviting the user into a previously unseen
group; such a new-group rumor is rejected. Group-level blocking is out of scope
for v1.

### Requests

For a previously unseen group:

- a first bootstrap author who is a saved contact sets `hasReplied = true` and
  routes the group to the main inbox;
- another bootstrap author leaves `hasReplied = false` and routes it to
  Requests;
- replying reuses `hasReplied` to accept the group;
- a saved group or any rumor authored by the local account on another device
  sets `hasReplied = true` and routes it to the main inbox;
- a blocked first author is rejected.

Persist this decision on the group conversation because its hashed conversation
key cannot be joined back to one contact. Subsequent authors do not independently
re-gate an already accepted group. Soft-delete resets `hasReplied`; the author of
the strictly newer event that resurrects the group is checked again under the
same contact rule.

### Deletion

An unbootstrapped local-only group has no remote history to preserve. Deleting,
leaving, or abandoning it hard-deletes its conversation row, message draft,
staged/pending attachments, and local group configuration. Cancel pending file
work before deleting its files so a late completion cannot recreate the draft.

An established group uses the existing direct-message soft-delete semantics.
Deleting records `deleted`, `deletedAt`, and the millisecond
`deletedOrderAt`, resets `hasReplied` and unread state, and removes the
conversation from visible lists. It does not delete messages, the cached
roster, bootstrap metadata, pending rumors, or the membership-action log.
Managed local attachment files may still be released under the existing
reference-counted cleanup policy.

A newly received visible message or action strictly newer than
`deletedOrderAt` resurrects the conversation and passes through the normal
contact-versus-Requests gate. Older or re-delivered messages do not. Replaying
already-known actions may update retained internal state but does not itself
unhide the conversation. Equality with the local millisecond deletion boundary
remains deleted.

## 8. Persistence

### Conversations

Add these columns to `conversations`:

```text
created_at
created_order_at
updated_at
updated_order_at
group_id
member_pubkeys
members_bootstrap_order_at
members_bootstrap_event_id
members_action_order_at
members_action_event_id
name_order_at
name_event_id
```

`group_id = null` continues to identify non-group conversations. The existing
`name` column caches the current custom group name. `member_pubkeys` caches the
active roster, initialized from local member selection or a received `create` or
`invite` bootstrap and changed afterward only by explicit invite/remove actions.
The bootstrap cursor is the baseline for that roster: actions older than it
cannot overwrite the roster when backfilled after an invite initialized a
previously unseen group.

For a locally created group, insert the conversation row as soon as member
selection completes. Persist the raw group id and the deduplicated roster of the
local creator plus all selected pubkeys there;
`members_bootstrap_event_id = null` marks the row as local-only until the first
`create` rumor is stored. Store the conversation's local creation time in
`created_at` plus its millisecond `created_order_at`, and initialize the matching
conversation updated fields `updated_at` and `updated_order_at`. Keep every
last-message field null until a real message exists. Composer drafts do not
change these timestamps. No separate
group-draft table is needed. Other devices learn the group only after the
`create` rumor is delivered.

Initialize a local-only group with `hasReplied = true`, `deleted = false`, and
zero unread so it appears in the main conversation list rather than Requests.
The first outgoing `create` preserves that accepted state.

Allow last-message fields to be null for a conversation with no messages. The
conversation list sorts by `updated_order_at`, with the conversation key as a
stable tie-break. `updated_at` and `updated_order_at` match the authored
timestamps of the message referenced by `last_message_id`, or creation time
while that cursor is null. Update the cursor and both timestamps atomically,
including during history backfill and archive import. Delayed older messages,
reactions, duplicates, drafts, and local-only metadata edits never independently
change the updated time. Keep debounced draft-text persistence and flush it on
navigation or background entry for crash safety without writing the conversation.

Existing conversation updated times are repaired through account-scoped,
indexed last-message lookups, falling back to creation time for empty cursors.

Store `member_pubkeys` as one deduplicated, lexicographically sorted array. This
intentional denormalization matches the small trusted-group scope: rewriting the
array occurs only when membership actions change the roster, never for ordinary
messages. Cache the parsed array per conversation where repeated reads matter;
do not add a normalized membership table in v1.

Persist the ordered membership-action history after the local bootstrap
baseline:

```text
group_member_actions
- account_pubkey
- conversation_key
- event_id
- author_pubkey
- member_pubkey
- action (invite or remove)
- order_at
- rumor
- applied

PRIMARY KEY (account_pubkey, event_id)
INDEX (account_pubkey, conversation_key, order_at ASC, event_id DESC)
```

Use the fixed hashed `conversation_key` for every auxiliary group-table join and
index, including before a conversation row exists. Keep the raw group id only in
`conversations.group_id` and the stored rumor's `h` tag; pending rumors can
recover it from their rumor when bootstrap later creates the conversation.

`members_action_order_at` and `members_action_event_id` cache the newest seen
membership-action cursor, including a currently inapplicable candidate. When a
new action is newer than that cursor, validate it against the current roster,
apply it incrementally when authorized, and advance the cursor in the same
transaction. This is the normal O(1) path.

Deduplicate a known event id before cursor work. When a newly seen action arrives
at or before the tail cursor, replay the group's retained formal and pending
actions from its bootstrap roster in shared event order, recompute derived
`applied` flags and the materialized roster, then reset the tail cursor to the
newest retained action. Import and rebuild use this full reducer once. Apply an
action only when its author is a member at that point;
`invite` adds its target and `remove` removes its target. A currently
inapplicable action that has never applied remains in `pending_group_rumors`,
because an earlier action arriving later may validate it. Promote it into
`group_member_actions` the first time replay validates it. Once promoted, retain
it permanently even if a later replay makes it inapplicable again, so the same
history can revalidate it. Plain messages never touch this table or the active
roster. Import and rebuild use the same reducer regardless of arrival order.

A never-applied candidate is not a visible message: it contributes no timeline
row, conversation preview, unread count, or notification. Its
first successful validation promotes it, stores its message row, and exposes
the fixed system capsule. From then on the row remains visible regardless of
later replay state.

Replay reconciles the materialized roster and derived action state in one
transaction. If a newly inserted earlier action invalidates an action that was
previously applied:

- reverse that action's roster effect;
- mark its derived membership effect inactive while keeping its system-message
  row, conversation-list preview, unread contribution, and timeline position;
- retain all ordinary messages already stored, even if their sender would no
  longer have passed authorization under the recomputed history.

If a later replay makes a retained candidate action valid, insert its message
row if it has never applied and apply the normal preview, unread, badge, and
notification rules for that first application. Unread state is always the
number of eligible visible messages after the read cursor; replay never adds an
extra unread increment of its own. Historical backfill and archive import do not
emit OS notifications, while real-time receipt and notification recovery retain
their existing notification-window rules. Action rows remain excluded from
full-text search. An action that applied before already remains visible and does
not notify a second time. Membership reconciliation must not rescan a
conversation's ordinary-message history or advance conversation activity.

Every action that has applied at least once remains in `messages`, including
actions whose roster effect is currently inactive, and is exported with
ordinary messages. The conversation caches the current roster and name, while
`group_member_actions`
is the canonical ordered membership-action log and stores the derived `applied`
flag. Replay considers both that log and unpromoted action candidates in
`pending_group_rumors`.

### Messages

Group rumor persistence needs no new message columns: stored tags and rumor JSON
already contain `h`, `p`, `subject`, and `action`. Delivery work separately
extends the existing `messages.delivery_status` enum with `partial`. A `create`
tag on the first text or file message retains bubble presentation. Invite,
remove, and rename appear as system lines. Once an invite or remove has applied
at least once, its system line stays visible even when later replay makes its
current roster effect inactive. A never-applied candidate lives only in
`pending_group_rumors` until replay first validates it.

### Durable relay delivery

Extend the existing normalized relay-delivery pipeline documented in
`docs/implementation/relay-message-delivery.md`; do not restore relay use of the
legacy `outbox.pending_payload` JSON.

The current durable model already has the required fan-out dimensions:

```text
relay_outbox_jobs
- one initial-send or retry job

relay_outbox_job_targets
- one unfinished recipient_pubkey × relay_url target

relay_outbox_payloads
- one durable gift wrap per job × recipient_pubkey

message_delivery_copies
- one long-lived recipient copy with its bounded relay-result array

messages.delivery_status / delivery_error
- coarse bubble and conversation-list state
```

Direct messaging and groups use this same pipeline. A direct message normally
has its peer and self copies; a group has every frozen `p` recipient plus self.
The rumor's immutable `p` tags freeze the audience when the message and unsigned
FIFO job commit in one transaction. Preparing relay targets later never rereads
the current group roster.

A target row means unfinished work. Preparation persists the fixed target set;
wrapping persists one gift wrap per recipient and job before publication. The
same wrap is reused across that recipient's relay targets and after process
recovery. Settling a target updates `message_delivery_copies` and removes the
target atomically. When one recipient has no targets left, delete that job's
payload for the recipient; when the job has no targets left, delete the job.
There is no timer-based sent cleanup and no per-attempt history.

Change the current all-or-nothing `prepareAllTargets` behavior for group fan-out.
Resolve each frozen copy's encryption key and relay list independently with
bounded parallelism, collect every success/failure, then commit the complete
preparation result in one transaction. Successful copies write relay
results/targets; a copy missing a key or relay list writes its nullable
copy-level error with no targets and does not abort other copies. This atomic
commit preserves the existing rule that any non-empty target set means
preparation is complete, so a crash before it simply repeats preparation rather
than mistaking a partial set for final. Derive the message aggregate only after
all copy outcomes are durable; if no targets remain, delete the job afterward.

Apply the same isolation during payload generation. Generate and persist each
recipient gift wrap independently in small yielded chunks. A recipient-specific
wrapping or signing failure records that copy's error, removes only that copy's
job targets, and continues other recipients. A session invalidation, account
change, or network cancellation pauses the job with unfinished targets intact
instead of converting them to copy failures.

Every user retry creates a new FIFO job and therefore a fresh gift wrap for each
selected copy. Before publishing, the job skips recipient/relay targets whose
durable result is already `ok`. Successful relay results are terminal and never
regress; explicit failures retry only through a user-created job. Account
switches and cancellation preserve unfinished rows, while account deletion uses
the existing generation guard and waits for started database writes before its
account-scoped wipe.

Extend `relay_outbox_jobs.scope` with `selected_copy` and add a nullable
`recipient_pubkey` selector used only by that scope. Change the retry API to
accept the selected recipient pubkey, including self. When failed relay rows
exist, create targets only for that copy and those URLs. When the copy has only
a pre-relay error, create a target-less `selected_copy` job whose preparation
re-resolves that recipient's key and relay list. Keep whole-message retry for a
failure that occurred before any copy state could be materialized. No separate
job-selector table is needed because the UI retries one copy at a time. Clear a
copy's pre-relay error atomically when retry preparation materializes its new
targets; a repeated preparation failure replaces it with the latest error.

Extend `messages.delivery_status` with `partial`. Extend
`message_delivery_copies` with a nullable copy-level error for failures before
relay targets exist, such as a missing recipient encryption key or relay list.
Per-relay `pending`/`ok`/`failed` results remain in the existing bounded JSON
array on each copy. UI rows read coarse state directly from `messages` and load
copy detail only while the delivery sheet is open.

Replace relay use of the current `surfacedCopies` aggregate. Run the existing
at-least-one-and-at-least-half relay verdict independently for every durable
copy, including self, then derive the message status from those copy verdicts.
All delivered is `sent`, a mixture of delivered and failed is `partial`, none
delivered is `failed`, and unfinished work remains `queued`. `sent` stays
terminal because every copy is already delivered; retrying a failed relay inside
an already-delivered copy never demotes that copy or message. Direct-message
detail and aggregation adopt the same all-copy behavior.

Do not rewrite historical delivery verdicts merely because new aggregation
includes self. Legacy rows retain their stored verdict. New sends use the new
all-copy rule, and a legacy message moves to that rule only when a user retry
produces newly settled state.

Evaluate relay delivery separately for each copy using the existing
direct-message rule: a settled copy is delivered when at least one target relay
accepted it and accepted relays account for at least half of that copy's relay
attempts. A missing encryption key, an empty relay list, or a settled copy below
that threshold is failed. Unsettled relay attempts keep the copy pending.

Relay-level retry remains available whenever a copy has failed relay results,
even when that copy already meets its delivery threshold. Such an optional
retry never demotes a delivered copy or its message aggregate to queued or
failed: successful relay outcomes remain credited, retried relay rows show their
own live state, and another failure leaves the copy delivered. A failure before
any relay results exist instead reruns that recipient's metadata resolution and
full copy attempt.

Match the current relay-delivery retention rule: each relay URL stores only its
latest settled outcome and error. FIFO jobs are ephemeral work, and neither jobs
nor durable copies retain attempt counts or per-attempt history.

Message aggregate status is derived from every frozen copy, including self:

- while any copy that has not already met its delivery threshold is wrapping,
  publishing, or otherwise unsettled: `queued`;
- all copies delivered: `sent`;
- some delivered: `partial`;
- none delivered: `failed`.

`sent`, `partial`, and `failed` are final aggregate results only after every
copy has settled. Before copy resolution finishes, an empty or not-yet-created
copy set remains `queued`. Self uses the same per-copy threshold, status,
attempt, retry, persistence, aggregate, and detail rules as every other copy.
Apply this behavior to direct messages as well as groups.

## 9. Sending

Compose the rumor and freeze its delivery audience before updating local group
state. The first text or file message carries `create` and the explicit initial
roster in `p`; its `p` tags address every initial member except the author, and
its `subject` communicates the current local custom name when one exists. An
ordinary send puts every current member except the author in `p`. An invite
also puts its new member in `p`, forming a bootstrap roster for a recipient that
has never seen the group; a remove retains its target in `p` so they receive the
notice. The raw group id goes in `h`.

Every group send path checks the current cached roster in the service layer
before optimistic storage or wrapping. If the local account is absent, reject
ordinary messages, files, replies, forwards, reactions, create, invite,
remove/leave, and rename. The UI mirrors this read-only state, but the service
check remains authoritative. A newer valid `invite` restores sending.

A send becomes admitted when the transaction storing its immutable rumor,
frozen `p` audience, and unsigned relay FIFO job commits. A remove processed
after that point does not cancel target preparation, wrapping, publication,
crash recovery, or manual retry for the admitted send; it only blocks later send
attempts. Each receiver still applies its own event ordering and membership
authorization.

For an own authored group action, the same admission transaction also inserts
membership history when applicable and applies its local roster or name effect.
Once committed, delivery failure never rolls back that state. The action capsule
exposes retry; a committed leave keeps the local group read-only even when every
remote copy failed, and its already-admitted copies remain retryable from
delivery detail.

Deduplicate and sort the frozen `p` pubkeys, then create one recipient copy for
each of them except the author, plus one copy for the sender's own inbox. The
immutable rumor's `p` tags, not the possibly updated local member roster, define
the audience for publication and retry. An ordinary group of N members thus
produces N copies including the self copy.

Recipient metadata lookup and delivery degrade independently. A missing key,
missing inbox relay, or publish failure for one member does not block copies for
other members.

Performance rules:

- resolve recipient encryption keys and relay lists with bounded parallelism;
- optimistically store and render the message before CPU-heavy wrapping;
- generate gift wraps in small chunks and yield to a macrotask between chunks;
- persist the independently prepared recipient/relay target set, then persist
  each job/recipient gift wrap before publishing any of its targets;
- never rebuild or resend any already successful copy during another copy's
  retry.

The message-detail screen retries one selected copy, including self. A
delivered copy still exposes retry when any of its relay rows failed; the retry
targets only those failed relay URLs. A copy below threshold does the same, while
a pre-relay failure rebuilds the selected copy's whole attempt. The shared
direct/group manual-retry service reloads the immutable stored rumor, resolves
the selected target's current encryption key, creates a fresh seal and gift
wrap, and publishes only that selected copy to the requested relays. It does
this even when an older durable gift wrap exists, so key rotation requires no
extra persisted key metadata. Successful copies remain untouched.

Crash recovery of an already-built in-flight attempt may republish its exact
persisted gift wrap, matching the existing outbox-resume behavior. A user
initiated retry is the boundary that refreshes wrapping and recipient metadata.

Attachments retain the existing efficient shape: encrypt and upload ciphertext
once, then carry the same key and nonce inside every recipient's encrypted
rumor. Network media upload cost does not multiply with member count.

Reactions and forwards use the same group authorization and per-recipient
fan-out pipeline. Reactions do not produce member or name state.

Forwarding always strips source routing and group-state tags, including `p`,
`e`, `h`, `subject`, and `action`, at the service boundary even when the caller
already sanitized them. Action system rows are not valid forward sources. When
an ordinary source message also carried its original group's `create`, remove
that tag; add a fresh `create` only when the destination is a local-only group
whose first forwarded text or file message establishes it.

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
- Creation and invite pickers reuse the same shared contact-entry source and
  visibility policy as the Contacts screen, including its current treatment of
  saved contacts that are also blocked. Do not add group-only blocked-contact
  filtering; any future visibility-policy change belongs in the shared contacts
  model so all contact surfaces change together.
- Exclude the active account from group creation because the creator is added
  automatically. The single-target invite picker excludes the active account
  and every current member; a previously removed contact remains eligible for a
  new invite.
- Require at least two selected people before creating a group. A single
  selected person uses the existing direct conversation flow. This minimum
  applies only to creation; later removals and leaves may reduce the roster to
  any size, including only the local user or no current members.
- Generate the group id as soon as selection completes and immediately insert a
  local-only conversation row, so drafts, attachments, file handoff, routing,
  the raw group id, and the selected roster survive restarts under the stable
  `group:<hash>` key.
- The first sent kind-14 or kind-15 text or file rumor carries `create` and the
  initial roster in `p` while remaining an ordinary message bubble. Storing it
  fills the bootstrap cursor and promotes the existing row from local-only to an
  established group.
- The group-info screen lists members and supports inviting one person,
  renaming, removing another member, and leaving through remove-self. Render the
  complete member list with a virtualized list.
- The group directory lists only established groups the user explicitly saves
  from the saved-list switch on group information. Local-only drafts do not
  expose it because they do not exist on another device yet. Saved state is
  independent of soft deletion and removal by another member, so history remains
  reachable until the user removes the group from the directory. Saving also
  accepts the group into the main inbox; every later message restores a deleted
  saved conversation there. An explicit local leave removes the saved state and
  publishes the replacement snapshot after the leave commits locally.
- Saved group ids sync as private `h` tags alongside `p` contacts in the
  NIP-44 encrypt-to-self `kind 30000`, `d=psstpsst-contacts` snapshot. Names,
  rosters, and presentation remain derived from group state. Local saved
  membership is migrated into the contact set before the old local `kind 30078`
  cache and outbox rows are deleted. The old coordinate is never queried or watched.
- Keep every membership operation on group info: add-member controls, per-member
  removal controls, and the local user's leave action all live there. An
  individual profile opened from the member list remains the ordinary global
  profile screen and contains no group actions.
- Add a standard profile row for viewing groups shared with that person. The row
  opens a common-groups list; it never exposes add, remove, leave, or rename
  controls. Reuse the standard group conversation-row presentation, sort by
  conversation activity, and open the chat history when a row is pressed.
  Resolve membership from cached `member_pubkeys` because group sizes are
  intentionally small; do not add a normalized membership table or expand
  conversation search for this feature. Include only groups that have a
  bootstrap event, are not soft-deleted, and currently contain both the active
  account and the viewed profile. Hide the profile row when the result is empty.
- Removing another member and leaving the group require the standard localized
  confirmation dialog before the action is authored. Invite and rename do not
  add a second confirmation; an invite that crosses the large-group threshold
  still uses the dedicated performance warning.
- The chat header title/avatar and sender names/avatars beside group messages all
  open the same group-info screen. Do not navigate directly from the chat
  timeline to an individual profile; member navigation starts from the member
  list beneath the group information.
- While the group is local-only, those controls edit or abandon local draft
  state without emitting system rows or network actions. After `create` is
  stored, they send the normal group actions.
- After the local user is removed, retain readable history, replace the composer
  with a plain-language read-only explanation, and hide group-management action
  entry points. Later messages from current members that still reach the local
  account remain visible without restoring membership.
- While read-only, suppress any preserved Draft preview in the conversation list
  and show the latest visible message or action instead. A valid re-invite
  restores both the composer draft and its normal Draft preview behavior.
- Exclude read-only removed groups from share and forward target pickers. A
  local-only group remains eligible; its first forwarded text or file rumor
  carries `create` and promotes the group like any other first send.

### Conversation presentation

- A local conversation with no message or draft reserves the normal preview-row
  height but renders no placeholder text. A persisted draft uses the existing
  Draft preview; the first message replaces it with the normal message preview.
- Add a centered system-row presentation for invite, remove/leave, and rename.
- Reuse the inline date-capsule visual family for system rows. Keep every row
  fixed at its event position in the timeline; system rows never become the
  floating sticky date capsule.
- Keep every system capsule on one line. Truncate dynamic arguments such as the
  sender name, target member name, and resulting group name independently with
  end ellipses, while preserving the localized action words. The accessibility
  label uses the complete untruncated text.
- Let a system row own an inline date separator or unread boundary at its event
  position and always break consecutive-sender bubble grouping across it. The
  row itself never participates in avatar, bubble-corner, or floating-date
  grouping calculations.
- For each consecutive run of received messages from one sender, show the
  sender name only on the first bubble, semibold at reduced opacity and aligned
  with the message text inset, and the sender avatar beside the final bubble. Reserve the
  logical-start avatar column across the run so bubbles do not shift
  horizontally. Own-message runs show neither name nor avatar.
- Keep the received-run avatar attached to the run's final bubble. It scrolls
  with that bubble and never floats independently. Its diameter matches a
  one-line text bubble's height.
- Use the custom name when present; otherwise show up to three names in stable
  pubkey order, including the local user while still a member, followed by the
  localized remaining-member count.
- Build the avatar collage from the first two to four members in the same
  stable pubkey order.
- Keep list and header names single-line and truncatable under the existing
  design rules.

### Delivery presentation

Do not put a numeric delivery fraction beside the bubble timestamp. The current
fixed-width status slot prevents layout shifts and must stay fixed-width:

- queued uses the existing pending glyph;
- all copies delivered uses the success glyph;
- partial delivery uses a fixed-size warning glyph;
- all failed uses the danger glyph.

Queued, success, partial, and failure all retain the same fixed-width status
slot beside the timestamp. Self participates in this aggregate exactly like
every other copy.

Own authored action capsules use this same status vocabulary and fixed slot,
despite having no bubble timestamp. Their detail sheet is identical to the
ordinary-message per-copy view.

The message-detail screen shows a count such as `7/11`, followed by one row per
copy with expandable relay results and a copy-specific retry action. Both
numerator and denominator use the full frozen copy set, including self: later
members do not appear, while recipients later removed from the group remain
because they were part of that send. Sort rows permanently by target pubkey
rather than delivery state so live updates do not move them. Each row shows the
target avatar and resolved name, with a shortened public key as the identity
fallback. Mark the self row with localized copy equivalent to `Your other
devices`; otherwise it behaves exactly like any recipient row. Direct-message
detail adopts the same two-copy view instead of hiding self.

This replaces the current flat-relay `deliveryCounts` and `surfacedRelays`
presentation for relay messages. The headline numerator is the number of copies
whose own relay threshold is delivered, and the denominator is the frozen copy
count. Relay counts exist only inside an expanded copy row. Change the resend
callback from a URL-only list to the selected target pubkey plus its failed URLs,
so two copies sharing a relay can never be retried together accidentally.

### Notifications

Ordinary text/file rumors and invite, remove, and rename actions all enter the
same notification eligibility and aggregation pipeline. The first `create`
rumor notifies once as its ordinary text or file message; it does not create a
second action notification.

Treat the group name, sender display name, sender avatar, and member names inside
action text as identity information governed by the existing `show sender`
preference. Treat the message preview or action detail as content governed by
the independent `show message content` preference:

- neither enabled: generic localized group-message title and open-to-view body;
- sender only: group name as title, generic open-to-view body, and sender avatar
  where available;
- content only: generic title and message preview without a sender prefix;
- both enabled: group name as title, `Sender: message preview` as body, and the
  sender avatar.

For an action with content enabled but sender disabled, use a localized
identity-free detail such as `A member was invited`, `A member left`, or `Group
name changed`. When both preferences are enabled, use the full localized action
text with member names. With content disabled, use the ordinary generic
open-to-view body.

Resolve at most the bounded title members and latest sender needed for the
notification; never load the full roster merely to build a preview.

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

The current account-removal flow already deletes account-scoped
`message_delivery_copies`, relay FIFO jobs, and legacy proximity outbox rows.
Add `group_member_actions` and `pending_group_rumors` to the same wipe. Clear
parsed-roster and action-reducer caches for the removed account as part of that
lifecycle. No raw group id, member pubkey, or pending rumor may survive
re-adding the account.

Reuse the current relay outbox generation guard, publish abort, per-message
write serialization, and `waitForIdle()` account-removal boundary. Group fan-out
must not add a second send-session lifecycle. Do not wait for or attempt to
retract network events that may already have published.

## 13. Suggested implementation order

Each phase should leave direct messaging working and have focused tests before
the next phase begins.

1. **Ordering and timestamp follow-up**
   - reuse the existing shared comparator and mixed-direction indexes;
   - add the indexed read-cursor/unread repair omitted by migration 0047;
   - add the ten-minute inner-rumor future check across every intake path.
2. **Group identity and pure helpers**
   - first-`h` parsing;
   - hashed conversation keys;
   - create/invite bootstrap rosters and subject snapshots;
   - action parsing and validation.
3. **Persistence migration**
   - conversation group fields and ordered membership-action history;
   - `pending_group_rumors`;
   - extend current message/copy delivery state for `partial` and pre-relay copy
     errors;
4. **Receive path**
   - create/invite bootstrap and pre-bootstrap quarantine;
   - current-member ordinary-message authorization;
   - ordered action replay and independent name LWW updates;
   - quarantine revalidation and bounded eviction;
   - Requests, personal-block boundary, unread, and notifications.
5. **Unified delivery refactor**
   - direct messaging as the one non-self recipient plus self case;
   - extend the current normalized relay FIFO for multi-recipient preparation;
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
   - update `docs/implementation/relay-message-delivery.md` for multi-copy
     preparation, self inclusion, selected-copy retry, and partial status;
   - run unit, integration, migration, i18n, and UI tests;
   - verify light/dark themes, RTL, dynamic text, and large histories.

## 14. Required tests

At minimum, cover:

- first-`h` parsing, arbitrary group-id hashing, and UTF-8 byte-length bounds;
- pending and action tables use the hashed conversation key while retaining the
  raw id only in conversations and rumors;
- shared event comparison, including equal `orderAt` with lower id newer;
- ordering migration selects the minimum id at equal `orderAt`, preserves a
  monotonic read boundary, and does not create upgrade-time unread messages;
- membership actions replay regardless of age before account history finality;
- partial backfill establishes no action cutoff, while a completed backward
  sync rejects every subsequently discovered network action in the finalized
  account range and leaves the cursor's current second open;
- action finality applies to create, invite, remove, and rename, drops the whole
  rumor, and purges now-unrecoverable quarantine entries;
- archive import bypasses network finality, while a finalized ordinary rumor is
  retained without applying its subject to name state;
- every permutation of the same membership actions converges to one roster;
- action authors are evaluated against membership at their ordered position;
- ordered membership actions take the incremental tail-cursor path, while an
  out-of-order insertion produces the same state through full replay;
- action replay can invalidate and later revalidate a previously applied action;
- replay changes an action's roster effect without hiding its system row or
  changing its established preview or unread contribution;
- never-applied action candidates remain absent from timeline, preview, unread,
  and notifications until replay first validates them;
- action message rows are included in normal message export and replayed on
  import;
- accepted rename/name events remain independent LWW state when membership
  actions replay;
- ten-minute future rejection for direct, group, reaction, file, and Nearby
  rumors;
- first-message `create` on text and file rumors retains bubble presentation;
- creation requires at least two other members, while established groups have no
  minimum roster size;
- creation/invite pickers inherit the shared Contacts visibility policy rather
  than introducing group-only blocked-contact filtering;
- creation excludes self, while invite excludes self/current members and permits
  re-inviting removed contacts;
- local group creation persists its conversation row, raw group id, and roster
  before the first message, then promotes that row on `create` storage;
- local-only groups start accepted in the main list with zero unread;
- pre-bootstrap membership and name management mutates only local draft state;
  the first create carries the final roster and custom name;
- message-free groups display and sort by immutable conversation creation time
  with null last-message cursors;
- draft persistence never changes conversation timestamps, including on
  navigation, composer close, or background entry;
- message-free, draft-free conversation rows preserve preview geometry without
  placeholder copy;
- last-message cursor and updated timestamps change atomically and agree across
  live intake, history backfill, and archive import;
- only the first `action` tag is parsed; later ones are ignored;
- a malformed or unknown first action drops the entire rumor instead of falling
  back to ordinary-message handling;
- malformed `p` values are ignored before addressing and bootstrap, while a
  malformed action target invalidates the action;
- bootstrap fails when valid filtered `p` values omit the local account;
- an `invite` bootstraps a later-added recipient from its `p` tags;
- a stale inviter roster produces the invitee's stale bootstrap without
  pre-bootstrap reconciliation;
- ordinary rumors received before bootstrap are quarantined and replayed;
- older actions backfilled after an invite bootstrap do not change its roster;
- an older `create` can render as history without reinitializing the group;
- other-authored group rumors without the local account in `p` are dropped;
- own authored self copies without the local account in `p` are accepted while
  the local account is a current member and dropped after removal;
- plain-message `p` additions and omissions never change membership;
- only newer `invite` and `remove` actions change membership after bootstrap;
- out-of-order invite and remove actions resolve per target;
- a remove received before its target's addition still prevents late re-addition;
- addressed messages from current members received after the local account is
  removed remain visible without restoring membership;
- every local send type is rejected after removal until a newer invite restores
  membership, with matching read-only UI and an authoritative service check;
- removal hides but preserves unsent local drafts, and re-invite restores them;
- read-only conversations suppress preserved Draft previews until membership is
  restored;
- removed groups are excluded from share/forward targets, while a local-only
  group can use its first forwarded text or file rumor as `create`;
- a send admitted before removal completes its frozen per-copy pipeline, while
  later send attempts are rejected;
- action admission applies local state atomically with message/outbox storage,
  and delivery failure never rolls it back;
- ordinary messages, reactions, and name events from non-current authors are
  dropped by the receiver;
- invite delivery includes the new member; remove delivery includes its target;
- retries retain the frozen `p`-tag audience after local membership changes;
- delivery details and counts use the full frozen copy set, including self,
  rather than the current roster;
- copy detail rows remain in stable target-pubkey order, identify each target
  with avatar/name/key fallback, and label self as delivery to other devices;
- independent subject preserve, set, and clear behavior;
- subject trimming and 80-code-point boundaries across ordinary, create,
  invite, and rename rumors;
- overlong rename actions are invalid while other overlong subjects only skip
  their name mutation;
- invite, remove-other, remove-self, and rename presentation;
- rename set/clear system rows and previews include the resulting localized name
  state, with full notification text gated by both privacy preferences;
- invite, remove, and rename follow ordinary-message unread, badge,
  notification, activity, and preview behavior;
- action system rows remain outside full-text message search;
- own action capsules expose fixed-width delivery status and the shared
  recipient detail/retry flow; incoming action capsules do not;
- remove-other and leave confirmations, without redundant invite/rename prompts;
- system action rows own timeline boundaries and break adjacent bubble grouping;
- action capsules remain single-line and truncate dynamic identity/name
  arguments without truncating their full accessibility label;
- received sender runs show one name at the start and one avatar at the final
  bubble, with stable avatar-column geometry across inverted-list scrolling;
- pre-bootstrap quarantine, roster-based release, and capacity-based eviction;
- never-applied action candidates share quarantine caps, while actions that
  applied at least once remain in the canonical log through later invalidation;
- older/backfilled messages never rolling current state backward;
- personal blocks inside existing groups and blocked new-group authors;
- contact versus Requests routing;
- group request acceptance is persisted explicitly from the bootstrap or
  resurrecting author rather than inferred from the hashed conversation key;
- saved groups use raw `h` values in the encrypted private contact snapshot,
  reconcile across devices, accept incoming activity into the main inbox, and
  are removed by an explicit local leave;
- group soft-delete preserves messages and group state, ignores older events for
  resurrection, and restores only for a strictly newer incoming message;
- deleting an unbootstrapped local group cancels pending file work and hard
  deletes its conversation, drafts, attachments, and local configuration;
- direct and group per-copy delivery, partial success, self-copy inclusion,
  persistence, restart recovery, and copy-specific retry;
- direct-message detail and aggregate include both recipient and self copies;
- legacy delivery aggregates are not recomputed during migration; a later retry
  adopts the new all-copy rule when it settles;
- existing account-scoped delivery copies and relay jobs remain covered by
  account deletion alongside the new group-owned tables;
- account switch/removal invalidates send epochs so late wrapping callbacks
  cannot recreate deleted local state;
- a crash after target preparation resumes the fixed normalized target set, and
  a crash before preparation re-derives it from the immutable rumor audience;
- persisted and in-memory `partial` state survives restart, retains retryable
  failures, and advances to `sent` without resending successful copies;
- relay jobs/targets/payloads own unfinished work, while account-scoped delivery
  copies and message columns own settled detail and coarse UI state;
- manual retry creates a fresh wrap with the selected target's current key,
  while crash recovery may resume the exact durable in-flight payload;
- selected-copy retry scopes relay targets and pre-relay metadata recovery to
  one recipient pubkey, including self;
- each copy applies the existing at-least-one-and-at-least-half relay
  delivery threshold independently;
- delivered and undelivered copies both allow retry of failed relay rows without
  demoting an already-delivered copy or aggregate;
- every manual retry creates a fresh normalized FIFO job, reuses terminal `ok`
  results, and deletes itself when no targets remain;
- relay rows retain only their latest outcome; no attempt history is retained;
- aggregate delivery remains queued until every not-yet-delivered copy settles;
- an unresolved empty copy set remains queued; self participates normally in
  every aggregate and detail sheet;
- self-only success or failure retains the fixed-width timestamp status slot;
- attachment upload-once behavior;
- group reactions and forwards;
- action rows cannot enter message content actions, and forwarding strips every
  source `action` tag before destination-specific create logic;
- conversation-key assumption audits;
- common-groups profile entry and list, without group-management controls or
  conversation-search expansion;
- common-groups filtering excludes local-only, deleted, and no-longer-shared
  groups and hides the profile entry at zero results;
- large-group warning without a hard cap;
- bounded default-title resolution and virtualized full member lists;
- notification privacy combinations;
- group names, sender identity, avatars, and previews obey the full independent
  privacy matrix without resolving unnecessary roster profiles;
- invite, remove, and rename notify through the ordinary pipeline; create emits
  only the notification for its ordinary message payload;
- i18n parity, RTL, light/dark themes, and stable bubble metadata width.

## 15. Explicitly out of scope for v1

- Standard NIP-17 room identity across membership changes.
- Administrators, roles, quorum, consensus, or malicious-member resistance.
- Group-level blocking.
- History delivery to new members.
- Automatic reconciliation of a stale roster supplied by an invite bootstrap.
- Read receipts.
- Automatic relay retry beyond the existing direct-message behavior.
- A hard member limit.
