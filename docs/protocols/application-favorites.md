# Private application library

My apps uses a NIP-51 app-curation set: kind `30267`, authored by the account,
with the legacy public tag `['d', 'psstpsst-favorites']`. There are no public application
references. `content` is a NIP-44 encrypt-to-self JSON array of tags:

- `['a', '<kind>:<pubkey>:<identifier>', '<optional relay>']` references napps,
  named/root napplets, and nsites. Root references keep the trailing colon.
- `['e', '<event id>', '<optional relay>', '<optional author>']` references an
  immutable kind-5129 napplet. An empty relay slot permits an author hint.
- `['r', '<http(s) URL>']` references a website, retaining path, query and fragment.
  This is PsstPsst's extension to the app-curation set.

Array order is the application order. Duplicate identities keep their first position;
relay hints do not change identity. An encrypted `[]` explicitly clears the
collection. Every publication is a full snapshot, including drag-order changes.
The normal replaceable-event freshness and local pending-write guards apply;
there is no per-item conflict-free merge of concurrent device edits.

Only application membership and order synchronize. Recency, manifests, application
data and permission grants remain independent. Known references are retained
when metadata cannot be fetched; only verified manifests may launch. Hintless
references use the publisher's write relays plus application-specific sources;
explicit hints constrain the manifest lookup. Background hydration has at most
four workers; overlapping resolution shares an in-flight lookup. Cached
replaceable manifests refresh asynchronously after their freshness window.
Metadata completion refreshes only the changed entry.

Event caches persist up to eight observed relay sources alongside each manifest.
Sources come from verified query delivery, never from the set of queried or
default relays. Identical event IDs merge observations; replacing a coordinate's
event resets its sources. Historical rows start empty. Copy and share pointers
use these observations plus existing address hints, without inventing locations.

Snapshots are bounded to 512 references, 1,048,576 plaintext characters and
2,097,152 ciphertext characters. Unsupported or malformed snapshots leave local
application membership intact; partial decoding never clears or silently truncates a list.

The cached encrypted event owns membership and order. A derived decrypted
snapshot supports immediate offline reads; it is keyed by event ID and never
represents a second authoritative membership table. A local edit commits the
complete pending reference array and its dirty revision in one transaction.
UI success and its toast depend only on that local commit. The shared private-list
queue reads fresh plaintext in a later macrotask, encrypts and signs, then
atomically checks the revision while handing off to the configuration outbox.
Signed publication failures use that durable outbox's retry policy. Preparation
failures retain dirty plaintext for a subsequent edit or configuration-sync pass.
Boot synchronization and self-event subscriptions apply newer snapshots only
when no local dirty or signed-pending revision supersedes them, checking again
inside the reconciliation transaction after decryption. Events use the account's
own configuration publication routing, not application catalogue relays. Live
filters also cover write/discovery relays already shared with the DM subscription.

Migration retires the former shortcut projection after preserving ordered
references as a pending draft or an event-keyed decrypted snapshot. Existing
unsigned drafts, including an empty collection, retain their revision and intent. Private-list revisions are keyed by account, kind and d-tag; existing
kind-30000 mute/block revisions retain their original identity and pending state.

The product calls this library My apps. Legacy storage/service names and the
`psstpsst-favorites` identifier remain compatible with existing account data.
Adding an application records membership, not endorsement or permission grants.
Removing it excludes future handoffs without closing it or deleting its data.
