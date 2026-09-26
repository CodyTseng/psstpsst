# Relay Message Delivery

Outgoing relay messages use an account-scoped durable FIFO. The message rumor
and an unsigned job are committed together; signing and network delivery happen
later for the active account. Foreground entry and network recovery wake the
queue. Backgrounding lets the current job finish but prevents the next job from
starting. Account changes and internal cancellation preserve unfinished work.

Each job owns a fixed set of recipient/relay targets once preparation succeeds.
It persists one gift wrap per recipient and reuses that wrap for every relay and
after interruption. A new user retry is a new job and therefore creates a fresh
gift wrap. Multiple jobs may reference one message; before publishing, each job
skips targets whose durable result is already `ok`.

A target row means unfinished work. A relay's boolean `OK` value alone decides
success. Settling a target updates the long-lived recipient copy and removes the
target atomically. `ok` is terminal; any other durable relay state may enter
`pending` when a job starts, and `pending` settles to `ok` or `failed`. Explicit
failures are not retried automatically. When no targets remain, payloads and the
job are deleted. No attempt history is retained.

Message-level delivery is derived from every durable recipient relay result,
not from the current job. It becomes `sent` as soon as at least one recipient
relay and at least half of all recipient relay targets have acknowledged it.
`sent` is terminal while unfinished mirrors continue in the queue. Otherwise it
stays `queued` while any job remains and becomes `failed` after all jobs finish.
Self/sync copies are retained but excluded from ordinary counts and manual retry;
a note-to-self uses its self copy only for the message-level verdict and detail.

The UI reads the coarse status from `messages` and reads compact recipient copies
only while message details are open. It never derives display state from queue
rows. Whole-message failures before publication live on the message; relay
failure strings live with the corresponding relay result.
