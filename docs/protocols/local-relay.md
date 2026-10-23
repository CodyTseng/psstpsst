# In-process local event store

The local relay is an application API over one device-wide SQLite cache, not a
WebSocket endpoint. It has no account key. It never reads private chat tables or
imports the existing account-specific metadata caches.

Explicit `nostrdb.add(event)` submissions, `napp.sync`, and live napp relay/outbox
subscriptions enter the store. One-shot remote queries, metadata reads and ordinary
publications do not insert events. Private-message kinds received on public relay
subscriptions can be delivered but are never admitted to the local store.
Submissions are copied, validated, and signature-verified before any write.
Signing, publication and local ingestion share NIP-01 structure validation,
without independent content, tag-count, tag-field or timestamp-window limits.
Encrypted direct-message and gift-wrap kinds are rejected. Duplicate ids are
ignored. Replaceable and addressable coordinates retain the newest event, with
the lower id winning timestamp ties. Ephemeral events notify live subscribers
without persistence. Expired events are neither returned nor admitted.

Queries support exact ids and authors, kinds, inclusive time bounds, limits, and
case-sensitive single-letter tag filters. Values within a condition match by OR;
conditions within a filter match by AND; multiple filters match by OR. Tag values
use a covering `(name, value, event_id)` index. SQL selects candidate metadata
before loading event payloads. Results sort by descending timestamp and ascending
id, deduplicate across filters, and are bounded to 1,000 events and 2 MiB per call.
`count` ignores result limits. Search extensions are unsupported; `supports()`
returns an empty extension list.

`event`, `replaceable`, and `remove` operate only on this cache. Removal does not
publish or process a NIP-09 deletion request. `subscribe` observes subsequent
accepted additions, without replaying stored events or applying query limits.
Subscribers receive isolated event copies only after commit. Iterators and remote
subscriptions are document-scoped, bounded, and closed on navigation or teardown.
Slow consumers receive an overflow error rather than silently losing events.

Persistence is bounded to 100,000 events and 128 MiB of event payloads, pruning
oldest insertions in small batches. A transactional statistics row avoids counting
the complete cache on each write. All database operations use the asynchronous
platform executor; payload decoding and signature fallbacks yield between chunks.
