# Configuration Publication Implementation

Configuration publication hands signed events to `configuration-publish.service.ts`.
The SQLite transaction stores both the replaceable cache and a pending outbox
row before relay delivery starts. Private-list actions (contacts with saved
groups, mute, and block) complete once plaintext and their durable revision are
committed; their background handoff does not affect the local result. Other configuration APIs may await
the signed handoff. Signing and storage errors still reject that handoff. Private sets remain encrypted to the identity before
entering the queue; plaintext lists and signing secrets are not outbox payloads.

The queue covers key announcements (10044), inbox relays (10050), read/write
relays (10002), profiles (0), private contacts (including saved groups), mute,
and block sets (30000), emoji collections (10030), emoji packs (30030), and Blossom
server lists (10063).
Messages, key-transfer exchanges, and wallet requests retain their own delivery
semantics and do not enter this queue.

## Message expiration settings

The account's message expiration settings use one NIP-78 kind `30078` event at
`d=psstpsst-message-expiry`. Its NIP-44 content is encrypted to the account's
identity. The plaintext is a versioned JSON tag array: `["v","1"]`,
`["default","<seconds>"]`, and zero or more
`["conversation","<conversation key>","<seconds>"]` entries. A missing
one-to-one conversation inherits the account default, and zero turns expiry off.
The default and overrides apply to Relay direct messages and Nearby chats.
Clients ignore obsolete group overrides. The public event exposes only the
document identifier.

The private-list revision queue commits local edits before signing. The
configuration outbox publishes the signed document to the account's write
relays. The self-event stream watches the exact account and document coordinate
on those relays with NIP-42 authentication. Startup reconciliation also applies
the latest decryptable snapshot. A local draft keeps its edited values when a
remote snapshot arrives. The subscription registers verified events for caching
before waiting for the signer. Before signing, publication waits for those cache
writes and reconciles an event that has not been applied to the local revision.
A concurrent cache write prevents the stale revision from committing. If
decryption fails, the draft stays pending. Signed snapshots follow the normal
Nostr replaceable event ordering.

## Replacement and completion

- The unique coordinate is `(account_pubkey, kind, d_tag)`. Plain replaceable
  kinds ignore `d`; addressable kinds use the first `d` value, including empty.
- Newer snapshots replace the pending payload and reset receipts, attempts, and
  deadline atomically. Ordinary local signing uses increasing timestamps for
  consecutive same-second edits. Relay and Blossom settings use their persisted
  edit time. Replaceable snapshots follow Nostr timestamp and ID ordering.
- Retries reuse the signed event. A definitive relay refusal settles that target
  for the event. The worker persists those refusals and stops once the current
  targets have all settled or quorum is met. Stopped rows with refusals prevent
  automatic repair from replaying the same event. A newer edit replaces them.
  Every result updates/deletes by coordinate
  **and event ID**, so a late response cannot delete or delay a replacement.
  Bytes already handed to a relay cannot be recalled; replaceable-event ordering
  ensures the newer snapshot wins there too.
- Private lists treat relay failure as a failed background attempt:
  remove only that pending event and mark its plaintext revision dirty. The next
  local edit generates a new complete event; stale failures cannot discard newer
  pending work.
- Completion requires `floor(current_target_count / 2) + 1` successful relay
  acknowledgements. Zero targets never succeeds. Receipts accumulate across
  attempts but count only toward the current target set. Removed targets cannot
  contribute to its quorum. Targets are normalized and deduplicated.
- Reaching quorum ends pending publication. Local configuration remains in the
  cache and local read models. Quorum is sufficient even if some replicas refused
  the event or were unavailable.

## Routing and recovery

`relay-router.ts` resolves targets from current local configuration on each
attempt: key announcements use DM ∪ write ∪ discovery; other configuration
events use write ∪ discovery. Destinations are not frozen when an event is saved.
The worker rechecks routing before deciding whether acknowledgements form a
quorum, since settings can change during a network attempt.

## Relay and Blossom settings

Adding, removing, or reordering inbox relays, write relays, or Blossom servers
commits the local list immediately. A pending edit in `routing_settings_edits`
takes precedence over the last signed declaration or its local read model.
Each list keeps at least one entry. Settings editors show a retry action if the
local transaction fails.

The worker starts signing two seconds after the latest edit to that list.
One durable row per account and kind holds the latest edit, its Unix timestamp
in seconds, and its deadline. The worker uses the edit timestamp for
`created_at` across debounce, restart, and retries. At the same second the
lexically smaller event ID wins. Legacy unsigned edits recover an approximate
timestamp from their stored deadline. Opening the app or regaining connectivity
preserves the debounce deadline.
A newer edit discards superseded queued events, and the signing handoff checks
the edit revision inside the transaction. A successful handoff caches the
signed event, updates the inbox or Blossom read model when applicable, and
removes the unsigned edit in the same transaction. Signing and delivery failures
retry independently of local use, including when a remote signer is unavailable.
Open settings editors observe committed changes to the effective lists. An
in-flight local write keeps its optimistic list visible until it settles. A
ready messaging session rebuilds its subscriptions from local settings on the
relay-change debounce. Refresh requests during initialization are coalesced and
applied after the session becomes ready.

Before signing a kind 10002 edit, the worker queries discovery and the previous
and newly selected write relays. It needs a signed declaration or a wire EOSE
from discovery or a previous write relay. An empty reply from a newly selected
relay, a timeout, or a closed read leaves the local edit effective and unsigned.
Once a baseline is available, the worker preserves the latest known read
membership, unrelated tags, and content. Delivery also attempts the previous
write relays so clients can discover the change there. Quorum uses the current
targets. When a shared tag would change either list's order, separate role tags
preserve both orders. The cache commit checks the base
event ID atomically and retries concurrent changes. A known newer declaration
supersedes older unsigned or signed settings work and updates the local routing
or server read model. Unknown markers are
preserved verbatim and grant neither role. An absent or empty marker grants
both roles. Local account creation advertises write-only defaults.

The active account's worker processes at most four events per batch and reads
only the earliest indexed deadlines. Connection and publish attempts have bounded
timeouts. Failures persist the receipts, last error, attempt count, and next
deadline. Retry waits are 1, 2, 5, 10, 30, then 60 seconds, capped at 60 seconds.
An explicit rate limit delays the next attempt by at least 30 seconds or the
relay's advertised NIP-01 wait, whichever is longer. The deadline survives
foreground entry, network recovery, and restart. Contact, mute, and block
failures other than rate limits retire the snapshot and leave plaintext for the
next local edit.

Account activation resumes the queue before messaging metadata lookup. Network
recovery and foreground entry wake retries early; backgrounding pauses scheduled
retries, and the next activation resumes them. This is asynchronous application
work, not an OS background-execution guarantee. Switching/signing out aborts the
worker; deleting an account removes its queued work. Only the active identity
is used for relay authentication.

A completed messaging-metadata lookup keeps relay results separate from the
local replaceable cache. If the queried relays omit a locally newer kind 10044
or 10050 snapshot, the exact signed event is returned to the publication queue.
If no signed snapshot exists, those declarations can be reconstructed from the
current local encryption key and inbox settings. Kind 10002 is never restored
automatically: a missing remote NIP-65 declaration may be an intentional
withdrawal rather than a failed publication.

Contacts retain a durable dirty revision until a signed snapshot enters the
queue. The queue then owns network delivery; remote reconciliation checks both
the dirty revision and pending snapshot, including after decryption. Other
private-list reconciliation also checks pending publication before applying a
remote snapshot.

## First local account setup

Only newly inserted, locally generated identities receive `local_setup_pending`.
Existing accounts default to false during migration, and imported identities do
not receive this marker. Marked setup generates or reuses a local messaging key,
persists its declaration and the default routing declarations, then clears the
marker. Interrupted attempts reuse the saved key and completed declarations.

The UI becomes ready after local setup. The first live messaging session uses
the persisted local metadata and skips its initial history pass; subscriptions
and queued publication start asynchronously. Later foreground entries and
ordinary launches use normal synchronization and remote key reconciliation.

## Muted group snapshot migration

The private `kind 30000`, `d = psstpsst-muted` snapshot uses `p` for direct
counterparty pubkeys and `h` for raw group ids. Reconciliation hashes `h` into
the local conversation key. On discovering legacy `g` tags, resolve their hashed
conversation keys against the account's conversations, convert them to `h`,
and enqueue a newer encrypted event while retaining the other private tags.
Normal publication writes only `p` and `h`.

If a legacy hash cannot be resolved, leave the snapshot and local mute flags
untouched and retry during a later sync. Migration observes the same pending
local work and cached-event guards as reconciliation; an atomic base-event
check prevents it from replacing a snapshot changed during encryption/signing.
The migration marks its local mute revision dirty and queues converted tags for
background publication. Crypto/cache/storage failure leaves local flags intact;
relay failure retires the pending event for regeneration on the next edit.

## Contacts and saved groups

Both domains share `kind 30000`, `d = psstpsst-contacts`: encrypted `p` tags
carry contact pubkeys and optional petnames, and encrypted `h` tags carry raw
saved group ids. Local edits commit with the same durable revision and return
before crypto begins. One background job per account coalesces queued edits,
reads both plaintext tables in a transaction, encrypts/signs, and queues the
complete snapshot. Crypto, cache conflicts, and delivery failures never reject
the local action. A failed attempt leaves its dirty revision until the next
local edit; queued subsequent edits still run using fresh plaintext. Remote
reconciliation updates both domains atomically and respects unsigned local work,
pending publication, and the cached event watermark.

Personal-config sync schedules migration independently of other refreshes and
reconciliation. Existing local `kind 30078`,
`d = psstpsst-saved-groups` cache/outbox rows trigger migration of the local
`saved_groups` read model. Reconcile locally cached contacts first, preserving
local saved membership while those legacy rows remain. The new complete list
is signed and durably queued; deleting the old cache and outbox rows commits
in the same transaction. Failure preserves the old rows and the shared dirty
revision for a future background publication. Removing those rows makes migration idempotent without a
wire-format version marker.

The old coordinate is never fetched or subscribed to, and its encrypted payload
is no longer decoded. After migration, ordinary snapshots replace both sets;
no `h` entries means no saved groups. Migration can run offline and a slow or
failed migration cannot prevent unrelated configurations from syncing.

## Block and mute synchronization

`private_list_sync_state` holds account/list revisions, dirty flags, and the
last signed event id for `psstpsst-blocked` and `psstpsst-muted`. Each local
edit commits its plaintext and dirty revision atomically, then queues a
background attempt. Block/unblock also updates the ingestion mirror immediately
after the transaction; crypto never delays the local action.

One job per account/list coalesces queued edits and reads the latest local set
inside a transaction. Revision and cached-event checks prevent a stale signed
snapshot from replacing newer work. Successful handoff clears that revision in
the same transaction as caching/queuing the event. Failure retains the durable
dirty flag, including across restarts, so remote reconciliation cannot erase
unsynced local state. No failure requests an immediate retry; subsequent queued
edits still run, and a later edit generates a new event from current plaintext.
