# Relay Message Delivery Implementation

Outgoing relay messages use an account-scoped durable FIFO. The message rumor
and an unsigned job are committed together; signing and network delivery happen
later for the active account. Foreground entry and network recovery wake the
queue. Backgrounding lets the current job finish but prevents the next job from
starting. Account changes and internal cancellation preserve unfinished work.

Each job owns a fixed set of recipient/relay targets once preparation succeeds.
It persists one gift wrap per recipient and reuses that wrap for every relay and
after interruption. A new user retry is a new job and therefore creates a fresh
gift wrap. Multiple jobs may reference one message; before publishing, each job
skips targets whose durable result is already `ok`, except for an explicit
`resend_all` job. That job republishes even acknowledged targets while preserving
the original rumor and prior successful delivery results. Repeated requests
coalesce while a resend job for that account and message remains unfinished.

A target row means unfinished work. Recipient metadata is prepared with bounded
parallelism and committed as one complete result: successful recipients gain
targets, while a missing key or relay list becomes a copy-level error without
blocking other recipients. Wrapping is likewise isolated per recipient and
yields between copies. Session invalidation pauses unfinished work rather than
turning cancellation into delivery failure.

A relay's boolean `OK` value alone decides
success. Settling a target updates the long-lived recipient copy and removes the
target atomically. `ok` is terminal; any other durable relay state may enter
`pending` when a job starts, and `pending` settles to `ok` or `failed`. Explicit
failures are not retried automatically. When no targets remain, payloads and the
job are deleted. No attempt history is retained.

Each copy is delivered when at least one target and at least half of its targets
acknowledge it. Message delivery uses every frozen copy, including self. A copy
that has not met its threshold and still has work keeps the message `queued`.
After all such work settles, all delivered is `sent`, some delivered is
`partial`, and none delivered is `failed`. An already delivered copy stays
delivered while an optional failed-relay retry is pending.

Manual retry selects one recipient copy, including self. Failed relay rows retry
only those URLs; a pre-relay copy error re-resolves that recipient's metadata.
Every manual retry creates a fresh gift wrap. Whole-message resend works for any
own stored rumor, including messages received from another device with no local
delivery records. It resolves current relay metadata for the rumor's original
recipients, including self; it never creates a new timeline entry.

The UI reads the coarse status from `messages` and reads compact recipient copies
only while message details are open. Detail rows remain in recipient-pubkey
order and expose per-copy relay results with a persistent summary resend action.
The UI never derives display
state from queue rows. Whole-message failures before copy materialization live
on the message; pre-relay failures live on the copy; relay failure strings live
with the corresponding relay result.
