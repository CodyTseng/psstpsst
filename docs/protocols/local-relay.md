# In-process local event store

The browser-facing API follows [NIP-DB](https://github.com/hzrd149/nips/blob/window.nostrdb/DB.md).

The local relay is an application API over one device-wide SQLite cache, not a
WebSocket endpoint. It has no account key. It never reads private chat tables or
imports the existing account-specific metadata caches.
`window.nostrdb` is available in hosted websites and Napps. `add` returns whether
the event was accepted; `remove` returns the IDs actually deleted, with internal
batching rather than a caller-visible ID-count cap.

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
conditions within a filter match by AND; multiple filters match by OR. Each local
array condition (IDs, authors, kinds or tags) uses its first 1,000 entries;
oversized arrays are truncated without a size error. Remote relay filters do not
use this local cap. Tag values
use a covering `(name, value, event_id)` index. SQL selects candidate metadata
before loading event payloads. Results sort by descending timestamp and ascending
id, deduplicate across filters, and are bounded to 1,000 events per call. Payload
size never silently omits an otherwise selected event, including single-event
and replaceable lookups.
`count` ignores result limits. Search extensions are unsupported; `supports()`
returns an empty extension list.

`event`, `replaceable`, and `remove` operate only on this cache. Removal does not
publish or process a NIP-09 deletion request. `subscribe` observes subsequent
accepted additions, without replaying stored events or applying query limits.
Subscribers receive isolated event copies only after commit. Iterators and remote
subscriptions are document-scoped and closed on navigation or teardown. Sync and
remote subscriptions submit each event as it arrives without waiting for EOSE.
Instances sharing one database executor share their write queue and listeners.
Trusted host runtimes broadcast committed public additions over the platform
event port, preserving cross-window notifications without scanning the cache.

Persistence is bounded to 1 GiB of event payloads with no separate event-count
cap; SQLite indexes and other database overhead consume additional disk space.
Oldest insertions are pruned in small batches. A transactional statistics row avoids counting
the complete cache on each write. All database operations use the asynchronous
platform executor; payload decoding and signature fallbacks yield between chunks.
