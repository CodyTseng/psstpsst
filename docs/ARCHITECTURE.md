# PsstPsst Architecture

> The durable system boundaries and data-flow rules for PsstPsst. Keep this file
> concise. Detailed behaviour belongs in code, tests, or a focused protocol
> document under [`protocols/`](./protocols/).

PsstPsst supports iOS, Android, and Electron. Ordinary web is not a supported
product runtime; React Native Web is used inside the Electron renderer.

The user-facing product name is `PsstPsst`; application identifiers, internal
namespaces, storage keys, and generated artifact prefixes use `psstpsst`.

## 1. System shape

The application shares UI and business logic across runtimes while keeping
operating-system access replaceable:

```text
UI (src/app, src/components)
  -> hooks and React stores
  -> services, database, and pure libraries
  -> platform ports
  -> Expo or Electron adapters
```

Dependencies point inward. Core code does not know which runtime is active.

Development and production use separate installed identities, OS permissions,
URL schemes, and local data. Desktop identity is fixed by packaged metadata
(unpackaged runs are development); development must never consume production updates.

## 2. Layer boundaries

### UI

`src/app/` and `src/components/` render state. They read through hooks and
stores, start work through services, and never access the raw database handle.
Frequently changing state stays close to the component that owns it.

### Core

`src/services/`, `src/db/`, `src/lib/`, `src/stores/`, and `src/i18n/` contain
business logic and shared data. These layers do not import `expo-*` or
`react-native`, except for the small sanctioned wrappers enforced in ESLint.
Services never import UI modules.

### Platform

`src/platform/ports/` defines small, async-first capability interfaces.
`src/platform/expo/` and `src/platform/electron/` implement them. A new OS
capability always starts as a port; callers consume `platform.<capability>` and
never select an adapter themselves.

The adapter registry is initialized before routes and services. Expo is the
mobile default. Electron installs its adapters synchronously from the preload
bridge before Expo Router evaluates application modules.

Electron application-binary updates run in the main process behind the
`appUpdate` port. The renderer owns localized consent, while automatic download
and install-on-quit remain disabled so each phase requires an explicit action.

## 3. Persistence and ownership

SQLite is the durable source of truth for non-secret application data. Drizzle
schema and migrations live in `src/db/`. Database access is asynchronous from
the renderer's perspective on every runtime.

- Every account-owned row is keyed by `account_pubkey`.
- Messages are immutable and deduplicated by event ID.
- Conversations are read models derived from messages and relationship state.
- Device preferences stay in SQLite; private keys and wallet secrets stay in
  secure storage. Electron boot-time metadata is the exception: the main
  process owns atomic local files for window geometry and update-check timing,
  independently of renderer startup and database migrations.
- Attachment bytes live in managed files, not database blobs.
- Local contact edits and their pending sync revision commit atomically. Remote
  contact snapshots cannot overwrite unsigned edits or queued publications;
  reconciliation checks pending work and a durable watermark after decryption.
- Live queries subscribe through `src/db/use-live-query.ts`; UI never imports
  the Expo SQLite binding.

Account removal deletes its secrets, managed attachments, archive data, and
account-scoped database rows. Shared caches are removed only when no remaining
account references them.

Electron runs `better-sqlite3` in a worker thread. The renderer sees only a
typed asynchronous proxy. Transactions are serialized, nested work uses
savepoints, and large reads stream in bounded batches.

## 4. Private messaging protocol

PsstPsst combines the
[NIP-4E proposal](https://github.com/nostr-protocol/nips/pull/1647) with
[NIP-17 private direct messages](https://github.com/nostr-protocol/nips/blob/master/17.md).

- The Nostr identity key identifies and signs for the account.
- A separate messaging encryption key is announced by kind `10044`.
- Message content uses NIP-44 v2 encryption.
- A kind-14 message or kind-15 file rumor is sealed as kind `13` and wrapped as
  kind `1059` following NIP-59.
- The recipient's NIP-17 inbox is published as kind `10050`.

The rumor is the canonical business message. Seals and gift wraps belong to
relay delivery and ingestion boundaries; UI, conversation, archive, reply,
reaction, and attachment logic operate on rumors rather than relay envelopes.

Conversation keys identify the counterparty within one owning account. The
current relay conversation model is one-to-one; group messages are not accepted
by the ingest path. Relay intake requires the sender's encryption-key `n` tag
inside the authenticated seal. A verified seal without it is unsupported and
marked processed without decrypting its content. Envelopes that fail decryption
with all available messaging keys are also marked processed; later key changes
do not retry them. Results from an invalidated receive session are discarded.

All signing goes through the `Signer` interface. Local private keys, remote
NIP-46 signers, encryption-key rotation, and device key transfer remain behind
that boundary. Remote NIP-46 round-trips are bounded; a timeout tears down the
cached bunker session so a later operation reconnects cleanly.

## 5. Relay routing

Relay routing follows the NIP-65 outbox model and distinguishes:

- discovery relays for finding public routing metadata;
- a user's write relays for their published events;
- a user's DM relays for private inbox delivery.

DM inbox edits publish only kind 10050 and never replace the independent NIP-65
read/write declaration. Only new local account setup initializes default kind
10002 metadata when that declaration has not yet been persisted. This app edits
only write relays; read membership configured by other clients is preserved and
does not participate in application routing.

`src/services/relay/relay-router.ts` is the single routing policy. Event
publication goes through one shared publish primitive, which normalizes relay
URLs, reuses managed connections, applies timeouts, and records per-target
results. Services do not open ad hoc relay connections.
Local relay-settings readers sit below routing and publication and never import
either layer.

Bounded queries wait for every target relay to settle before merging results.
EOSE means a REQ ended: a wire EOSE, deadline (even without events), or relay
closure completes it. AUTH success resends the REQ with a fresh deadline;
unavailable, rejected, or timed-out AUTH also ends the query. Only failure to
connect/start the REQ is a network failure; caller cancellation is separate.
Caller cancellation releases active and queued queries without closing shared
sockets. If every relay fails, the query reports a network error; failures must
not be cached as confirmed empty results. Queries collect events from the same
subscriptions as live consumers and close them after the initial read ends.
EOSE does not remove a subscription; receiving and reconnecting continue only
while its owner keeps it registered. REQ and AUTH handling are shared.

Replaceable metadata is cached newest-wins. Fetches are batched and deduplicated
so many rows asking for the same profile, relay list, or key announcement do not
repeat network work.

Configuration publication is a durable, account-scoped outbox, separate from
message delivery. A signed snapshot and its cache commit before asynchronous
network delivery; saving never waits for relay acknowledgements. Only the newest
snapshot per author/kind/`d` coordinate remains pending. Each attempt resolves
current routing and retries unacknowledged targets; a strict majority of those
targets completes publication. Account activation and foreground/network recovery
resume pending work independently of messaging readiness. See
[configuration publication](protocols/configuration-publication.md).

## 6. Message lifecycle

### Sending

1. The UI inserts the outgoing message optimistically.
2. The service creates the immutable rumor and stores it with a durable,
   account-scoped FIFO outbox job in one transaction. A job row means unfinished
   work; completion deletes it.
3. CPU-bound encryption/signing and synchronous native work are deferred to a
   later macrotask so the optimistic frame can paint. One signed gift wrap per
   recipient/job is persisted and reused across that job's relay targets and
   crash recovery.
4. Active job targets are normalized recipient/relay rows. Settling a target
   updates its compact long-lived recipient copy and removes the target in the
   same transaction. Explicit failures wait for a user retry; interrupted
   pending jobs resume for the active account after startup, foreground, or
   network recovery.
5. Delivery status is derived from acknowledgements, not merely from a socket
   write succeeding.

Recipient relay attempts settle independently under a hard deadline. At least
half of the recipient relays must acknowledge the message, with at least one
acknowledgement required. Failed relays remain individually retryable even after
the message is considered sent, and retries do not target relays that already
acknowledged it.

The message-level verdict is derived from all durable recipient relay targets,
never from one job's subset. Successful relay results are terminal. A manual
retry creates a fresh gift wrap; recovery of the same interrupted job reuses its
persisted wrap. Self/sync copies are retained but excluded from ordinary
delivery counts, except for note-to-self messages.
See [relay message delivery](protocols/relay-message-delivery.md) for the queue
and state-machine details.

### Receiving

1. Message subscriptions, backfill, and background polls wait for a completed
   refresh of the account's DM routing and encryption-key announcement, and for
   the announced private key to be available locally. The first session of a
   newly generated local identity is the exception: a durable creation marker
   permits local key/configuration setup and subscriptions without remote lookup.
   The marker clears after configuration is queued; imported and established
   accounts retain remote reconciliation. Local history may render
   while preparation runs. An observed change to the announced encryption key
   invalidates the old receive session, except an echo of the current local key.
   Old announcements and same-key republications do not interrupt receiving.
   A fresh key check and initialization must precede resumption; missing keys
   require key transfer first.
   Live subscriptions then receive a bounded recent tail.
   Metadata refresh waits for all routing targets to settle, then selects the
   newest known events. At least one effective EOSE is required despite failed replicas.
   With no completed response, startup retries without enabling message intake.
2. Backfill uses persisted cursors to recover history and starts only while the
   app is active, including foreground re-entry. An already-started pass may
   continue after backgrounding; foreground transitions do not start overlapping
   passes. Background polls, socket recovery, and background session reinitialization
   never start history backfill. Account/key changes still cancel stale work.
   Notification polls page only a fixed recent overlap window, independently per
   relay, and never advance the persisted history cursors. Timeouts and saturated
   timestamp boundaries leave coverage unconfirmed. See
   [notification recovery](protocols/notification-recovery.md) for paging limits.
3. The service removes and verifies any transport envelope, then verifies the
   author, recipient, event ID, and supported rumor kind before storage.
4. Duplicate events are ignored without duplicating conversation state.
5. Successful inserts update the conversation read model and invalidate only
   relevant live queries.

Message chronology uses the authenticated `(order_at, id)` cursor. A larger
`order_at` is newer; equal timestamps follow the Nostr replaceable-event rule,
where the lexicographically smaller event ID is newer. Pagination, unread
watermarks, conversation heads, notifications, and media views share this rule.

Mobile local notifications and badges use the project-owned native notification
module behind the platform ports; no remote push SDK is linked. Notification
cleanup must preserve Android's foreground-service notification.

On macOS, an in-process Node-API bridge queries and requests notification
authorization asynchronously for the app's own identity. Capability probes must
not request permission or stand in for an OS grant. Notification settings refresh
authorization on foreground return; opening system settings is a typed port action.

Notifications are privacy-first and best-effort. Sender information (avatar and
display name together) and message content are two device preferences that
default off. A device-level quiet-hours window (do not disturb) suppresses
delivery at the `notifyNewRumors` intake and again at the flush boundary; messages arriving
inside the window are stored and counted as unread but never notify, and
nothing is queued for catch-up delivery when the window ends. An
aggregate retains only its newest eligible rumor for an opted-in preview; file
messages use a localized attachment label rather than their encrypted URL. When
notifications are enabled for a verified receive session, Android uses a user-visible
`remoteMessaging` foreground service plus a long-running React Native headless
task to keep the live relay
session resident. Service-owned receive readiness controls both residency and
periodic recovery independently of mounted UI. Key invalidation closes the old
relay pool, cancels intake and pending notification delivery, stops the resident
service, and unregisters periodic recovery without changing the notification
preference. A cold poll that discovers an unavailable key also unregisters itself;
only successful receive initialization restores background work.
After notification permission is granted, Android requests a
Doze exemption once because the Nostr relay transport cannot use FCM. Some
Android vendors suspend React Native timers even in that
state, so one native deadline backs up scheduled relay/subscription retries and
notification delivery; it is cancelled when no work is pending or the app is
active. Relay ping/idle detection remains owned by `nostr-tools`; Android uses
a longer heartbeat interval and longer backoff for persistent background failures.
The resident headless task is reused across service updates because transport
timeouts still depend on RN timers. The periodic WorkManager poll remains a recovery
path. It skips redundant reads only after history backfill completes in an
uninterrupted live session whose DM and own-metadata subscriptions have received wire EOSE
and whose sockets have recent inbound traffic. Otherwise it immediately presents
its result because a cold task cannot
assume the resident native clock is running. iOS performs the periodic background
poll without a central push server. The iOS expiration signal cancels active and
queued relay queries so an exhausted execution window releases its network work
promptly and does not degrade future scheduling. Electron uses a persisted
main-process timer while the application remains running; notification presence
requires the window to be both visible and focused, and transient desktop
delivery failures do not change the user's preference. A routed conversation
advances its read cursor only while the user is present; returning to the
foreground marks the still-open conversation through its newest message.
Background message ingestion and self-event reconciliation must not await React
Native timers; their UI-yield timers are active-state only.

The active account's main-inbox unread aggregate is a single service-owned read
model derived from SQLite. Tabs, chat chrome, and platform app badges observe the
same count. A conversation the user is currently viewing is excluded from the
aggregate while the user is present — opening it marks it read and its incoming
messages never bump unread, so counting it would only flash a figure that is
about to drop. Posted notifications carry the database-derived total; Android
launcher badges follow the system notification lifecycle and may disappear when
notifications are dismissed.

## 7. Large-history performance

Conversations may contain hundreds of thousands of messages. No screen or
service may assume a complete history fits in memory.

The embedded SQLite adapter uses WAL plus a bounded busy timeout so the UI,
headless background work, and development inspection tolerate brief connection
overlap. Detached resumable work must consume and log failures with their native
cause; cursor progress remains unchanged so the next session can retry safely.

- Message history reads use indexed chronology cursors. Each database read
  prefetches one bounded batch, then releases UI-sized slices to FlatList before
  the reader reaches the edge. FlatList mounts variable-height rows in small
  frame-spaced batches. Exposed data is append-only during ordinary history browsing,
  while native virtualization bounds mounted rows. Scrolling toward newer rows
  never removes list data or re-queries SQLite. Tail and anchored windows retain
  their loaded pages across in-screen mode switches and release them only with
  the conversation screen session. Anchored windows own independent older and
  newer cursors; neither direction grows a query from the anchor.
- Message rows carry only a coarse persisted delivery status. Compact,
  account-scoped recipient copies hold the bounded per-relay detail and are
  queried only while the message detail sheet is open. The UI does not infer
  message state from outbox rows or session memory.
  Reply targets outside a loaded window are batch-read by indexed ID with their
  source history page and cached for the screen session. Scrolling must not
  drive reply-target queries or React state updates.
- Search returns identifiers and opens a small window around the target.
- Reactions stay attached to retained message pages; database-only reply targets
  resolve with the fetched source page and remain cached for the screen session.
- Incoming messages are staged while the user reads older history and merged at
  the live tail.
- List rows subscribe only to their own changing state.
- Expensive derived values, profiles, keys, and routing metadata use bounded
  caches and in-flight deduplication.

Avoid synchronous SQLite, crypto, sorting, hashing, or file work on the render
path. An `await` does not make synchronous native work non-blocking; yield a
macrotask before work that would prevent a frame from painting.

## 8. Attachments

Kind-15 attachments are encrypted with a fresh symmetric key before upload.
Media servers store ciphertext and are not trusted with plaintext. The message
carries authenticated URL, key, nonce, MIME, size, and optional integrity
metadata inside the encrypted rumor.

- Verify ciphertext and plaintext hashes when supplied.
- Strip image metadata before upload when re-encoding will not destroy content.
- Store downloaded plaintext in a content-addressed managed-file pool.
- Deduplicate by plaintext hash and reference-count deletion across accounts.
- Download and decrypt lazily; media lists never load attachment bytes eagerly.
- Image resources resolve local files before requesting download consent. Image
  cache lookup and authorized download are separate platform operations; rendering
  cached bytes never hands a remote URL to an image view as a fallback.
- Treat integrity mismatch as a security decision, not an ordinary retry.
- Static chat images default to an off-thread, size-bounded optimized encoding;
  the sender may choose original quality per batch. Image preparation finishes
  before hashing and encryption, so every transport references identical final
  bytes. The UI remains in `preparing` until native image work completes.
- Attachment batches reserve authenticated message-order slots before optional
  supplementary text is authored, so the text remains after every selected file
  even while image preparation and transport continue asynchronously.

Nearby carries the same kind-15 rumor and, when capability-negotiated, transfers
verified plaintext chunks inside Noise over BLE. The immutable rumor authorizes
the exact peer and plaintext hash. A separately resumable encrypted spool is
uploaded to the rumor's Blossom targets with the Proximity identity. Sending
gives that upload a bounded first attempt, and receiving tries Blossom before
BLE, preserving remote retrieval and forwarding without exposing the owning
Nostr identity. BLE plaintext and Blossom ciphertext partials have independent
offsets and converge only after mandatory `ox`/`x` verification.
Electron performs Blossom inspection and range retrieval in the main process;
the renderer receives bounded response chunks through the file-system port and
never depends on a media server's browser CORS policy.

## 9. Accounts, relationships, and configuration

The device can hold multiple accounts, but only one is active in the UI.
Switching accounts tears down account-bound subscriptions and services before
starting the next account; persisted data remains isolated by `account_pubkey`.

Contacts, conversations, requests, mute, and block are separate concepts:

- Saving or removing a contact does not create or delete a conversation.
- A first message from an unknown sender remains a request until accepted by
  product rules.
- Conversation acceptance is not media-download consent. Non-contact attachments
  and media bytes require per-resource intent; unresolved relationships hold those
  downloads. Profile cards and relay metadata resolve independently of sender trust.
- Mute changes presentation; block rejects the sender at ingestion.
- Device-local preferences and relay-synchronized private lists remain
  explicitly distinct.

Messaging encryption keys may rotate. A bounded local key history preserves
late-message readability. New devices acquire the current key through the
authenticated key-transfer flow; an announced key the device does not possess
gates messaging until synchronization completes.

Versioned ZIP archives contain unencrypted message content and export relay
messages separately from Nearby history. Nearby message files are partitioned
by the device-local public key that owned them, and peer labels are included
without connection consent or block state. Import validates structure, paths,
hashes, and ownership before merging durable state.

Nearby import resolves the peer and conversation owner from the current device's
Nearby identity when it is the message sender or recipient; otherwise it keeps
the archive owner's perspective. The signed-in Nostr identity is not used for
this resolution. Existing conversation ownership must still match.

Archive export is a local-only snapshot. Including attachments copies only
managed files already present on the device and never downloads remote media.

## 10. Nearby messaging

Nearby Messaging uses a public, device-local proximity identity rather than
exposing the owning Nostr identity. That identity signs a durable Noise static
key binding. An automatic Noise XX handshake authenticates the binding and
derives forward-secret directional ChaCha20-Poly1305 record keys. First-contact
consent remains a separate durable product decision and is not repeated on
reconnect. Messages send an immutable unsigned rumor inside the authenticated,
encrypted local record protocol. The session binds the rumor author to the peer
that proved possession of the proximity and Noise private keys and supplies
confidentiality, integrity, replay protection, and connection-level forward
secrecy. Durable outbox work, acknowledgement, deduplication, and retry use the
rumor event ID.

Core code accesses stateful Noise only through the async `NoisePort` and holds
opaque handshake or session handles. On mobile, a native Noise-C module owns and
serializes the cipher state off the JavaScript thread. Electron owns it in a
dedicated worker thread. Cipher keys, chaining keys, and nonce state never enter
the renderer or proximity service.

Nearby-list radio presence is driven only by BLE advertisement scan results and
expires 15 seconds after the last result. Cached connection RSSI and protocol
traffic never extend presence; authenticated PING/PONG independently owns
connection liveness. Presentation retains a trusted peer with a live
authenticated connection even after radio presence expires, labels its signal
unavailable, and removes it when that connection closes.

Public name changes notify subscribed Profile readers for immediate Nearby-list
refresh. Ready trusted sessions also carry a capability-negotiated encrypted
profile-update control record, which authoritatively updates durable peer and
conversation labels without creating a chat message or unread state.

Every Nearby conversation persists the proximity public key that owns it.
Messages inherit that ownership. A conversation owned by a different local
proximity identity is readable but cannot author new messages until identity
migration is explicitly supported.

The focused protocol specification is
[`protocols/nearby-messaging.md`](./protocols/nearby-messaging.md).

## 11. Navigation and overlays

Expo Router owns one navigation state. Responsive layouts change only its
presentation: narrow windows show a stack; wide tablets and Electron show a
persistent primary pane plus detail. Resizing must not create a second route
state or remount the active application session.

Native modal presentation is serialized. A modal that opens another closes
first and continues from `onClosed`; guessed delays are not a coordination
mechanism. Gesture-heavy overlays keep animation and gesture arbitration on the
UI thread.
On Electron, Reanimated writes styles directly to the DOM. Resolve animated
logical insets to direction-aware CSS properties; React Native's `paddingStart`
and `paddingEnd` aliases are not translated along that update path.

Message lists, composers, and account services remain mounted only when their
state is still relevant. Route parameters carry identifiers, never large
message, attachment, or browser-file payloads. Dynamic route parameters are
already decoded by Expo Router and are treated as untrusted at the route
boundary: accept one bounded scalar of the expected format, or leave the route
before starting queries, media work, or cryptography.

Native gesture, keyboard, and safe-area providers live above account gates so
screen replacement does not interrupt their event subscriptions.

## 12. Runtime and security boundaries

The Electron window is sandboxed with context isolation and no renderer Node
integration. Preload exposes typed operations rather than raw IPC. Navigation,
external URLs, file paths, and protocol links are validated in the main process.
Custom note-app schemes open only links matching the device's saved URL template;
ordinary content links retain the external-scheme allowlist.
Privileged files, crypto, SQLite, notifications, and native dialogs stay out of
the renderer.

Electron secure storage uses OS `safeStorage` when it provides credential-grade
encryption. Otherwise an application password protects an authenticated,
atomically replaced encrypted vault. Secrets never fall back to plaintext.

Mobile adapters use Expo modules behind the platform ports. Native modules load
lazily so tests and runtimes without a capability can import the adapter set
without side effects.

Render failures terminate at the root route error boundary instead of replacing
the application with an unrecoverable blank surface. A bounded on-device journal
stores only the error type, sanitized stack frames, route template, and runtime
version metadata. It never stores message content, identity values, secrets,
wallet data, or URLs, and it leaves the device only through an explicit user
export. Repeated failures favor a safe return to the Chats route over retrying
the same broken route again.

Wallet connections are non-custodial. NWC connection strings pass between
routes only through ephemeral memory, never URL parameters. Their secrets stay
in secure storage, and a payment requires system authentication or the
account's wallet PIN immediately before the request is sent.

## 13. Change rules

- A new OS capability starts with a platform port.
- A new durable model starts with schema ownership and migration rules.
- A new background task defines lifecycle, idempotency, timeout, and retry.
- A new list or query states its data bound and incremental update strategy.
- A new protocol or transport gets a focused document under `docs/protocols/`
  instead of expanding this file.
- Visual conventions belong in [`DESIGN.md`](./DESIGN.md), not here.
