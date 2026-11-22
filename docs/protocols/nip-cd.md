# NIP-CD command discovery

PsstPsst discovers kind-31992 declarations explicitly scoped to kind-14 messages
using `{kinds:[31992],authors:[peer],"#s":["kind:14"]}`. Kind 10992 user-saved
lists and the previously proposed kind 10993 advertisement are not queried or
required for suggestions.
Definitions follow the [NIP-CD draft](https://github.com/nostr-protocol/nips/blob/master/CD.md).

Discovery follows the same profile hook lifecycle and `fetchProfiles` entry
point, including warm and bulk requests. Queries use count-guarded NIP-65 write
relays, default discovery relays and explicit profile hints. Pending profile and
command reads share a bounded subscription per relay with separate filters.
Typing reads only local cache and never starts a relay query.

Each verified declaration is stored through the shared replaceable-event cache
at `(author,31992,d)`, using its newest-wins ordering and memory mirror. Discovery
tracks successful author queries, including empty results, with a bounded
session-memory 24-hour freshness cache and concurrent-call deduplication. A new
session discovers the author again so previously unseen coordinates can be found.
Each completed refresh reconciles the union of received declarations with the
author's cached collection: add new coordinates, update existing ones and delete
missing ones, including clearing all commands after a completed empty result.
Reconciliation commits atomically and invalidates the affected memory mirrors.
All known write relays must complete before removing commands; without known
write relays, all fallback targets must complete. Partial refreshes may add or
update received declarations but never delete cached ones or advance discovery
freshness, so failed source queries remain retryable.
A connected subscription reaching its query deadline counts as effective EOSE;
connection and authentication failures remain failures.
Malformed newer definitions that match the relay filter remain cached and retire
older valid versions.
Verification yields between chunks, and database writes remain asynchronous.

Suggestions read all cached declarations for the current peer and match their
scope against the outgoing kind-14 rumor, active account author, known recipient/
reply/subject tags and cached delivery inbox relays. Alternatives within one
scope type are ORed; different types and tag names are ANDed. Unknown constraints
and unresolved context are excluded conservatively. Nearby and group
conversations are not discovery sources. List editing, argument pickers, local
command execution and invocation chips are outside this implementation.

Tapping or pressing Enter sends `/<command>` through the ordinary composer send
path when no arguments are declared. Commands with arguments and Tab completion
insert `/<command> ` for editing instead. Declaration content and argument
metadata are never evaluated or published. Existing encryption and delivery
remain unchanged; unrecognized commands and malformed invocations can still be
sent as ordinary text.
