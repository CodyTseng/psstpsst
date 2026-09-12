# Configuration publication

Configuration saves hand signed events to `configuration-publish.service.ts`.
The SQLite transaction stores both the replaceable cache and a pending outbox
row before relay delivery starts. A successful save means locally persisted;
network failure does not turn it into a failed save. Signing and storage errors
still reject the handoff. Private sets remain encrypted to the identity before
entering the queue; plaintext lists and signing secrets are not outbox payloads.

The queue covers key announcements (10044), inbox relays (10050), read/write
relays (10002), profiles (0), private contacts/mute/block sets (30000), emoji
collections (10030), emoji packs (30030), and Blossom server lists (10063).
Messages, key-transfer exchanges, and wallet requests retain their own delivery
semantics and do not enter this queue.

## Replacement and completion

- The unique coordinate is `(account_pubkey, kind, d_tag)`. Plain replaceable
  kinds ignore `d`; addressable kinds use the first `d` value, including empty.
- Newer snapshots replace the pending payload and reset receipts, attempts, and
  deadline atomically. Local signing uses increasing timestamps for consecutive
  same-second edits. Already signed snapshots follow Nostr timestamp/ID ordering.
- Retries reuse the signed event. Every result updates/deletes by coordinate
  **and event ID**, so a late response cannot delete or delay a replacement.
  Bytes already handed to a relay cannot be recalled; replaceable-event ordering
  ensures the newer snapshot wins there too.
- Completion requires `floor(current_target_count / 2) + 1` successful relay
  acknowledgements. Zero targets never succeeds. Receipts accumulate across
  attempts but count only toward the current target set. Removed targets cannot
  contribute to its quorum. Targets are normalized and deduplicated.
- Reaching quorum removes the pending row. The local configuration/cache remains;
  absence from the queue means no signed snapshot is awaiting publication, not
  that every replica has accepted it.

## Routing and recovery

`relay-router.ts` resolves targets from current local configuration on each
attempt: key announcements use DM ∪ write ∪ discovery; other configuration
events use write ∪ discovery. Destinations are not frozen when an event is saved.
The worker rechecks routing before deciding whether acknowledgements form a
quorum, since settings can change during a network attempt.

Write-relay edits refresh kind 10002 from discovery and the known/new write
relays before merging. They replace only write membership, preserve read
membership (including the read side of unmarked tags), and retain unrelated
tags and content. A failed refresh aborts the save. The cache commit checks
the merged event's base ID atomically, rejecting concurrent changes rather
than overwriting them. Local account creation advertises write-only defaults.
Unknown relay markers are preserved verbatim but do not grant read or write
membership in routing or the editor. An absent or empty marker grants both roles.

The active account's worker processes at most four events per batch and reads
only the earliest indexed deadlines. Connection and publish attempts have bounded
timeouts. Failures persist the receipts, last error, attempt count, and next
deadline. Retry waits are 1, 2, 5, 10, 30, then 60 seconds, capped at 60 seconds
without a retry limit. A failed destination never requires re-signing an event.

Account activation resumes the queue before messaging metadata lookup. Network
recovery and foreground entry wake retries early; backgrounding pauses scheduled
retries, and the next activation resumes them. This is asynchronous application
work, not an OS background-execution guarantee. Switching/signing out aborts the
worker; deleting an account removes its queued work. Only the active identity
is used for relay authentication.

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
