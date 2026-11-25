# Relay history and notification recovery

## History coverage

Live subscriptions start with `limit: 0` and no timestamp bounds. A relay's
history pass starts in the foreground only after that relay reaches wire or
timeout EOSE. An already-started pass may continue in the background. Retry a
failed replica independently of healthy ones.

Keep forward and backward frontiers per account and relay. A new relay inherits
the frontiers of the least-covered existing replica. Forward history overlaps
the gift-wrap randomization window and deduplicates by envelope ID. Persist a
fixed window and its page checkpoint, resume it before a newer gap, and advance
the watermark and clear the checkpoint in one write after completion.
Foreground throttling can skip a fresh forward scan on eligible platforms.
It leaves interrupted windows and unfinished backward history eligible to run.

Verify and store each history envelope as it is processed. Keep authenticated
deletion requests with absent targets pending and check them in the target's
insert transaction. A deletion received after its target can hide a message
already shown, including when both arrive in the same page. Reactions can be
stored before their targets and appear when the matching visible message is
loaded. History reactions and group reactions promoted from quarantine do not
create previews or notifications. Checkpoint after the page has been processed.
Retries deduplicate committed rumors. Receive transactions recheck session
ownership after waiting for the writer lock.

Reconnect recovery has its own recent window and one task per relay. It
coalesces repeat reconnects and uses normal arrival intake. Reconnect and
notification recovery leave durable history coverage untouched. Account or
key changes invalidate all three paths.

See [the DM service](../../src/services/dm/dm.service.ts) and
[sync cursor storage](../../src/services/dm/sync-store.ts).

## Notification polling

Periodic notification recovery scans gift wraps for the account in the inclusive
window `[poll cutoff - 49 hours, poll cutoff]`. The cutoff stays fixed throughout
the run. This accommodates randomized envelope timestamps; it is not a durable
arrival cursor. Older messages wait for foreground history recovery.

After refreshing routing and encryption-key metadata, the poll visits each DM
relay with `since`, `until`, and `limit: 500`. Each relay keeps its own `until`;
rounds alternate between relays. Events are processed and stored before moving
the boundary. Processed gift-wrap IDs skip repeated decryption and notification.
Only one page is retained by the pager at a time.

The next query includes the oldest returned timestamp again. Even a short page
needs another query: a relay may impose a smaller result limit. Empty EOSE
responses finish a relay. Wire EOSE and the 25-second timeout fallback both
complete a page; timeout reasons remain available for diagnostics. CLOSED and
connection failures leave the page incomplete, although received messages are
still stored. Other relays can continue when one fails.

History and recovery share a fixed page limit of 500. Once a query is confined to the current
boundary second, it moves to the preceding second without raising that limit.
NIP-01 offers no secondary event-ID cursor, so events sharing a timestamp beyond
the relay's returned page may remain undiscovered. Boundary reads are best-effort.

Polling does not read or write `forwardSince` or `backwardUntil`. Interruption
does not seal any history frontier; the next poll rechecks its recent window.
Older gaps remain the responsibility of history backfill. OS expiration,
session replacement, or an observed key change cancels ongoing work.
