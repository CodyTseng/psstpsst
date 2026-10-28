# PsstPsst Architecture

> The durable system boundaries and data-flow rules for PsstPsst. Keep this file
> concise. Interoperable event and wire formats belong in
> [`protocols/`](./protocols/); product and runtime details belong in code,
> tests, or [`implementation/`](./implementation/).

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

Android application tasks use non-exported document Activities with separate
React surfaces on one trusted ReactHost. Each application owns its runtime,
WebView and cancellation scope; account services and the serialized approval
queue remain process-owned. Only the foreground Activity presents that queue.
Account lifecycle changes and source access revocation close the affected tasks.
Website opening preferences are host-owned account/site data, separate from
capability grants. Website keys retain their full shortcut URL; signed site keys
omit relay hints. Launchers read the saved website choice before selecting a host;
napps and napplets always use independent native hosts when available.
Both the main Android Activity and independent application tasks cancel pending
web input when predictive back starts, using the same native callback.
Native application hosts deduplicate opens by account and canonical application
source. Their process-owned instance registry drives focused-window restoration
and UI running indicators; icons never infer running state from visit history.
Task intents carry opaque in-memory
session identifiers, so process death removes stale tasks rather than restoring
account authority from intent extras.

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
- Conversation `updated_at` and `updated_order_at` equal the timestamps of the
  message identified by `last_message_id`, or the conversation's creation
  timestamps when that cursor is empty. Message writes maintain both pairs
  atomically; drafts and metadata edits do not change them.
- The group directory is an explicit account-scoped saved set, mirrored across
  devices in the private contact snapshot (`p` contacts, `h` raw group ids).
  Both domains share one durable revision and atomic reconciliation. Saving
  accepts the group into the main inbox; an explicit local leave removes it.
- Relay groups use `group:<sha256(h)>` conversation keys, retain the raw `h`
  value separately for rumors and private lists, and materialize a sorted roster
  from an ordered membership-action log. Non-bootstrap unknown-group rumors wait in a
  bounded account-scoped quarantine outside hot message queries.
- Device preferences stay in SQLite; private keys and wallet secrets stay in
  secure storage. Electron boot-time metadata is the exception: the main
  process owns atomic local files for window geometry and update-check timing,
  independently of renderer startup and database migrations.
- Attachment bytes live in managed files, not database blobs.
- Private-list edits commit atomically with durable sync revisions and complete
  independently of background encryption, signing, and publication. Contacts and
  saved groups share a revision; mute and block have separate account/list
  revisions. Failed sync leaves plaintext authoritative across restarts until
  the next local edit. Reconciliation rechecks dirty revisions, pending work,
  and the cached event after decryption.
- Live queries subscribe through `src/db/use-live-query.ts`; UI never imports
  the Expo SQLite binding.

Storage upgrades run after SQLite setup and secure-storage unlock, before preferences,
account bootstrap, notification initialization, or application content. The upgrade
covers inactive accounts, normalizes message keys inside the vault, binds existing
wallet routing metadata without consent prompts, and moves legacy preferences into
SQLite. Completion is recorded only after every step succeeds; interrupted work is
idempotent and retryable, and old records are removed only after successful writes.

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
- The device materializes the newer key evidence for each peer identity from
  incoming seals and kind `10044` announcements. Both sources share one signed
  event-time ordering rule, so every local account reads the same current peer row.
  Migration seeds existing announcements into that table; later announcements
  are queried for a missing row, an explicit refresh, or a background daily
  freshness check when a conversation opens. Freshness uses the local fetch
  time, not the signed event time; conversation entry never opens a key subscription.
  Key and DM-relay freshness share one device-wide, peer-deduplicated background
  queue with bounded concurrency. Queued work continues after navigation. A
  completed empty kind-10044 lookup records `announcement_checked_at` on an
  existing seal-derived peer row, preventing another lookup until the daily TTL.
- Message content uses NIP-44 v2 encryption.
- A kind-14 message or kind-15 file rumor is sealed as kind `13` and wrapped as
  kind `1059` following NIP-59.
- The recipient's NIP-17 inbox is published as kind `10050`.

The rumor is the canonical business message. Seals and gift wraps belong to
relay delivery and ingestion boundaries; UI, conversation, archive, reply,
reaction, and attachment logic operate on rumors rather than relay envelopes.
Authored payloads such as payment requests are created independently of their
destination, then sent through one conversation target carrying the delivery
kind, conversation key, and group marker. UI flows never reconstruct a separate
recipient model for content that is sent to the current conversation.

Direct conversation keys identify the counterparty within one owning account.
Group conversation keys hash the private rumor's stable `h` identity; explicit
`invite`, `remove`, and `rename` tags drive membership and presentation.
Ordinary text/file rumors can bootstrap an unknown group from their authenticated
author and audience, independently of its first message.
Membership changes replay in shared message order, while ordinary messages
authorize incrementally against the materialized roster. Once full account
history is covered, its persisted forward cursor rejects newly discovered
backdated actions in the finalized range. Relay intake requires the sender's
encryption-key `n` tag
inside the authenticated seal. A verified seal without it is unsupported and
marked processed without decrypting its content. Envelopes that fail decryption
with all available messaging keys are also marked processed; later key changes
do not retry them. Results from an invalidated receive session are discarded.
Encryption-key announcement and synchronization are specified in the
[PsstPsst NIP-4E Profile](protocols/nip4e.md). Split-key envelopes, message
timestamps, and stable-group events are specified in
[PsstPsst NIP-17 Extensions](protocols/nip17-extensions.md).

All account signing goes through `Signer`. An account owns its implementation;
consumers hold revocable leases. Closing an application releases only its lease.
Ending an account session invalidates outstanding results and releases connections
and cached keys without deleting saved credentials. Only explicit account removal
or credential replacement deletes or replaces persistent secrets. NIP-46 client keys are generated inside sealed pairing sessions, never supplied by
callers. A completed handshake installs a client once; subsequent pairing attempts
cannot replace its key or saved credential. Account removal deletes the complete
connection credential set. Legacy DB-secret migration fills only an empty slot.
Saved bunker credentials bind their recipient public key. Startup migration trusts
existing SQLite routing metadata to establish missing legacy bindings; existing
bindings cannot be replaced. Subsequent unbound connections require trusted confirmation. Bunker timeouts
discard the connection and permit a later reconnect.

Stored account identity keys, relay messaging keys, nearby signing/Noise identities and NIP-46 credentials are accessible only
inside the key vault: an Electron worker or mobile native module. Generic storage
bridges reject those namespaces. Mobile vault storage uses native-only records separate
from Expo SecureStore. iOS uses a separate Keychain item class: only messaging keys
use a dedicated messaging access group; all other credentials use an explicit
app-private group. The extension has no entitlement to the previous all-shared
group; only the app retains it for migration. Android uses atomic AES-GCM files
under its no-backup directory with a dedicated Keystore alias. Legacy
credentials migrate within native code; old records are removed after the durable
write. A durable migration marker prevents later SecureStore writes from being
reimported as vault credentials, including after restart. Noise handshakes consume saved static keys without returning their bytes.
Wallet NWC secrets and PIN verifiers share native/worker custody. The host relays
only fixed-method, encrypted requests and verified responses; wallet keys have no
generic signing or decryption reference. Payment authentication runs in the trusted
platform before an invoice-bound request can be signed. PIN failure counts and cooldown
deadlines persist with the verifier across process restarts. Signed NWC request events
pass through the host transport; wallet-side request deduplication remains necessary
because encrypted network events can be replayed. Trusted approval derives
the amount from that invoice and rejects unreviewed monetary override parameters. PIN fields and approval
state never enter host JavaScript. Startup migration binds legacy wallet credentials
to their existing SQLite peer and relays without prompting; later requests cannot replace that binding. Wallet migration has its own durable marker and cannot
reopen completed signer migration.
The public platform facade excludes raw secret storage and vault transport; only designated key-owning
services may import the internal transport. Ordinary consumers receive the narrow
Signer capability. These code boundaries prevent accidental access; native/worker
validation and the absence of secret-read operations enforce secret custody.
Trusted platform gateways own request dispatch, input surfaces, confirmations and
clipboard export. They hold no key storage or business state; key-purpose and
protocol validation remain inside the vault.
User-supplied import credentials may pass transiently through host forms. Import
returns only public metadata, never stored secrets. Identity import has a dedicated
input-only operation outside generic dispatch.
Messaging services receive only current-key public metadata and membership-query results;
the retained key list stays inside the vault. Account message decryption
selects current and retained keys inside the vault, uses the same key for both envelope layers,
and returns unreadable events as outcomes rather than infrastructure errors.
Messaging-key decryption is unavailable through the generic crypto operation.
Key transfer produces or imports encrypted packages inside the vault. New-account identity material and
key-sync temporary keys are native-owned and discarded when its task ends.
All account backup, including newly generated accounts, and outgoing key transfer require trusted platform confirmation with bundled
localized wording; callers select a language, never supply approval text. Backup
copies inside that boundary and never returns an nsec to the renderer; it does not
automatically clear the clipboard. iOS backup writes are local-only to prevent Universal Clipboard synchronization. The existing OS-backed vault and desktop
password fallback remain the storage protection and unlock mechanisms. Desktop
password entry uses a separate sandboxed security window; the host receives only
an unlock outcome. A small allowlist is the only remaining legacy-preference
reader, and it cannot access credentials.
Only the main app migrates Keychain records; notifications arriving before the
first upgraded app launch use the generic fallback.
Notification processing uses a separate native vault with only messaging
decryption and fixed event-retrieval authentication authority.

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

`RelayTimeline` owns reusable in-memory event pagination. Each relay/query pair
has an independent cursor and buffer; ordered merging and event-ID deduplication
happen before results reach consumers. Callers supply the verified transport and
own domain parsing, display windows and cache policy. Full application discovery
and napps-only capability discovery keep independent cursors, caches and loading
state; exact-address metadata may be shared across them. Durable message-history
coverage remains in the separate account/relay sync cursor store.

Relay addresses share `src/lib/nostr/relay-url.ts` normalization at input,
metadata, persistence-read, and transport boundaries. Equivalent addresses use
one identity for routing, connection reuse, delivery tracking, and sync cursors;
signed incoming events retain their original tags.
Canonical addresses use URL serialization, including `/` for the root path.
Blossom server addresses follow the relay path/query normalization rules and
return HTTP(S) URL serialization verbatim; legacy stored addresses normalize on read.

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
network delivery; these saves do not wait for relay acknowledgements. Only the newest
snapshot per author/kind/`d` coordinate remains pending. Each attempt resolves
current routing and retries unacknowledged targets; a strict majority of those
targets completes publication. Account activation and foreground/network recovery
resume pending work independently of messaging readiness. See
[configuration publication](implementation/configuration-publication.md).

Manual DM, write-relay, and Blossom server-list edits instead wait for a bounded publication attempt
and a strict majority of the deduplicated targets to acknowledge the event.
Their local configuration commits after confirmation; failed edits remain in
the form for an explicit retry and never become background publication jobs.
Initial account setup still uses the durable configuration outbox.

## 6. Message lifecycle

### Sending

1. The UI inserts the outgoing message optimistically. Attachment pending state
   and upload attempts are service-owned and shared by in-chat sends and external
   shares. External file placeholders are enqueued before destination navigation;
   persistent staging preserves retry bytes independently of the OS share grant.
   Confirmed uploads survive route changes; pause and cancellation are explicit.
   Recipients control their own pending message independently. A shared upload
   continues while any recipient needs it; pausing a recipient suppresses its
   message and preserves prepared file data for resume. Stored messages release
   staging files immediately, independently of presentation. Visible placeholders
   use the permanent local mirror for handoff; unopened chats retain no placeholder.
   Terminal cleanup metadata survives interrupted deletion and is never restored
   as a retryable send.
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
acknowledged it. Explicit whole-message resend republishes to all current relays
for the original recipients, including acknowledged targets, without changing
the rumor identity. It also supports own rumors received from other devices.

Each frozen recipient copy resolves metadata, wraps, publishes, and settles
independently. The message-level verdict is derived from every copy, including
self: all delivered is `sent`, some delivered is `partial`, none delivered is
`failed`, and unfinished non-delivered work is `queued`. Successful relay
results are terminal. A selected-copy retry creates a fresh gift wrap; recovery
of the same interrupted job reuses its persisted wrap.
Recipient preparation uses complete local peer-key and DM-relay metadata
immediately and queues its TTL refresh in the background. If either local piece
is missing, preparation waits for its one-shot lookup before deciding that the
recipient is unreachable.
See [relay message delivery](implementation/relay-message-delivery.md) for the queue
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
2. Each DM relay owns an independent backfill task and persisted account/relay
   cursors. A newly added relay inherits both frontiers from the existing relay
   with the smallest covered interval; an existing relay retains its own progress.
   Failed relays retain their gaps and retry with bounded backoff without
   blocking healthy replicas. Only a wire EOSE confirms page coverage; deadlines
   and relay closures never advance a frontier. Tasks start only while the app
   is active, including foreground re-entry. Forward recovery re-reads the
   gift-wrap randomization window before its previous wall-clock watermark;
   processed envelope IDs deduplicate the overlap. Each account/relay persists
   a fixed pending forward window and its last wire-confirmed page checkpoint.
   Recovery finishes that window before scanning a newer gap; only completion
   atomically advances the watermark and clears the checkpoint. An already-started
   pass may continue after backgrounding; foreground transitions do not start overlapping
   passes for the same relay. Group history finalization uses the conservative
   coverage intersection of the currently configured DM relays. Background polls,
   socket recovery, and background session reinitialization never start history
   backfill. Account/key changes still cancel stale work.
   Notification polls page only a fixed recent overlap window, independently per
   relay, and never advance the persisted history cursors. Timeouts and saturated
   timestamp boundaries leave coverage unconfirmed. See
   [notification recovery](implementation/notification-recovery.md) for paging limits.
3. The service removes and verifies any transport envelope, then verifies the
   author, recipient, event ID, and supported rumor kind before storage.
4. Duplicate events are ignored without duplicating conversation state.
5. Successful inserts update the conversation read model and invalidate only
   relevant live queries.
6. Inner rumors more than ten minutes ahead of local time are dropped before
   conversation routing. Group intake additionally checks addressing, current
   membership, bootstrap quarantine, and action finality before visibility.

Message chronology uses the authenticated `(order_at, id)` cursor. A larger
`order_at` is newer; equal timestamps follow the Nostr replaceable-event rule,
where the lexicographically smaller event ID is newer. Pagination, unread
watermarks, conversation heads, notifications, and media views share this rule.

Mobile notifications and badges use the project-owned native notification
module behind the platform ports. iOS APNs registration requires explicit
notification consent; relay mutations use the account identity signer and durable
registration/revocation state. Its notification extension runs the shared
TypeScript receiver and notification policy in an independent JavaScriptCore
runtime. Mobile notification
cleanup must preserve Android's foreground-service notification.

APNs event resolution attributes gift wraps to `wss://relay.psstpsst.chat/`.
ID references use its fixed HTTPS event endpoint, with durable processed-ID checks
before fetching. Transport resolution never substitutes for shared intake validation
or final deduplication. WebSocket, history, recovery and APNs use the same
gift-wrap validation/decryption/storage code with explicit receiving-account,
key and runtime context. Notification eligibility and preview construction are
shared across live/recovery delivery and the extension; UI account selection
never selects the owner of an APNs message.

The iOS app and extension share an App Group database in WAL mode, serialize
writers before reading their transaction snapshots, and share only messaging
credentials through Keychain after the first device unlock. Independent receivers
check durable account ownership inside writes, including account removal. External
writes invalidate bounded foreground caches and live queries. A successful insert
owns notification eligibility; duplicate envelopes or rumor IDs never produce a
second alert attempt. Missing keys and failed decryption remain retryable after
key reload, with bounded failure deduplication within a receive session.

iOS notification presence holds its App Group file lock only while the main app
is active, releasing it before background suspension. Transient probe contention
retries asynchronously only while active. Extensions treat an absent
lock as no foreground user, regardless of stale shared lifecycle preferences.

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
assume the resident native clock is running. iOS has no periodic background
worker: APNs invokes the notification extension, which uses the shared gift-wrap
intake and notification policy. Opening the app resumes normal relay sync. Electron uses a persisted
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
  newer cursors; neither direction grows a query from the anchor. List data
  materializes requested rows lazily and shares a position Map with its window.
  Edge pagination adjusts a window offset and indexes only new history;
  the bounded live overlap is reindexed when its membership changes;
  replacing the window resets both data and lookup scope.
- Message rows carry only a coarse persisted delivery status. Compact,
  account-scoped recipient copies hold the bounded per-relay detail and are
  queried only while the message detail sheet is open. The UI does not infer
  message state from outbox rows or session memory.
- Resolved conversation lists seed an account-and-conversation-scoped session
  snapshot cache. A pushed chat reads that snapshot synchronously for its first
  title and avatar commit, while the delayed live query remains authoritative
  after the navigation transition.
  Reply targets outside a loaded window are batch-read by indexed ID with their
  source history page and cached for the screen session. Scrolling must not
  drive reply-target queries or React state updates.
- Search returns identifiers and opens a small window around the target.
- Reactions stay attached to retained message pages; database-only reply targets
  resolve with the fetched source page and remain cached for the screen session.
- Incoming messages are staged while the user reads older history and merged at
  the live tail.
- List rows subscribe only to their own changing state. Memoized row actions
  resolve the current committed message window when dispatched. Electron
  positions mounted targets from current DOM geometry rather than stale
  virtualized height estimates, excluding header and composer occlusion.
- Expensive derived values, profiles, keys, and routing metadata use bounded
  caches and in-flight deduplication.

Avoid synchronous SQLite, crypto, sorting, hashing, or file work on the render
path. An `await` does not make synchronous native work non-blocking; yield a
macrotask before work that would prevent a frame from painting.

## 8. Attachments

Kind-15 attachments are encrypted with a fresh symmetric key before upload.
Outgoing media dimensions and ThumbHash independently prefer Blossom upload
metadata; missing values come from the actual plaintext file (after image
optimization), through platform adapters. Picker and preview dimensions are UI hints.
Live upload previews read file metadata before transfer and reuse it for missing
upload-descriptor fields; server metadata still takes precedence in the rumor.
Media servers store ciphertext and are not trusted with plaintext. The message
carries authenticated URL, key, nonce, MIME, size, and optional integrity
metadata inside the encrypted rumor.

- Attachment download tasks and progress are shared by the original attachment URL
  within an account, across message bubbles and media viewers. Nearby message IDs
  remain authorization and partial-file references; upload progress uses pending IDs.
  Mounted consumers follow replacement tasks and verified completion without
  initiating additional remote downloads.
- Network attachment downloads expose byte progress and cancellation through the
  file-system port. Completed ranges stay in the evictable cache for continuation;
  mutable resources require a server validator, and servers ignoring Range restart
  the representation. Completed ciphertext remains available through verification
  and decryption until plaintext publication succeeds; integrity failures discard it.
- Verify ciphertext and plaintext hashes when supplied.
- Strip image metadata before upload when re-encoding will not destroy content.
- Store downloaded plaintext in a content-addressed managed-file pool.
- Deduplicate by plaintext hash and reference-count deletion across accounts.
- Download and decrypt lazily; media lists never load attachment bytes eagerly.
- Local video posters are small, evictable image caches shared by chat and media
  lists. Poster work is deduplicated and concurrency-bounded, never fetches remote
  media, and survives list remounts without mounting a player per row.
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
- A group bootstrap from an unknown sender remains a request until local
  activity accepts it; later remote messages and membership actions never
  promote it into the main inbox.
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

Back actions check navigation availability when dispatched. Stale events while
session gates have unmounted the navigator are ignored, never deferred into the
next session.

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
Explore exposes a document-scoped WebLN provider over those NWC connections.
Initialization requires no access approval and is independent of signer grants.
Each debit selects its wallet in a fresh host review and requires authentication.
Navigation and source permission changes invalidate pending payment consent;
the wallet queue rechecks it immediately before
publication. Account-owned payment-hash claims commit before publication and
survive wallet removal and application-data resets. Uncertain results never
trigger an automatic retry. Only a verified payment preimage completes a page's
payment request. Implementation details live in
[`implementation/webln.md`](implementation/webln.md).


## 13. Change rules

- A new OS capability starts with a platform port.
- A new durable model starts with schema ownership and migration rules.
- A new background task defines lifecycle, idempotency, timeout, and retry.
- A new list or query states its data bound and incremental update strategy.
- A new interoperable event or wire format gets a focused specification under
  `docs/protocols/`. Product, persistence, runtime, and delivery details belong
  under `docs/implementation/`, in code, or in tests.
- Visual conventions belong in [`DESIGN.md`](./DESIGN.md), not here.

## Explore

Explore opens Nostr application/site addresses and HTTP(S) URLs through isolated
platform containers. Napplets retain their sealed NAP runtime. Napps and nsites
load signature-verified multi-file manifests and hash-verified assets; websites
load their actual URL and receive a bounded NIP-07 bridge. The host alone assigns
the requesting main-frame origin and document lifetime. Navigation cancels old
approvals. Navigation start blocks document requests until a trusted commit event;
requests cannot establish or replace a document lifetime. Native response-download
policies are separately bound to the pending navigation and its initiating committed
document. A retained DOM can resume after an uncommitted load ends, with a fresh token
and lifetime; previously aborted operations stay revoked. Websites expose privileged
capabilities only over HTTPS. Subframes receive no independent bridge, but same-origin
frames and scripts share the top-level origin's authority. Untrusted embedded content
must use an independent origin or an opaque sandbox without same-origin access.
Remembered permissions trust the application identity or website origin across content
updates until expiry or revocation; content updates do not establish new trust identities.
Website signing grants bind the full origin, while
Nostr applications and sites use canonical naddr identities.
Protocol-specific route adapters supply data and actions to shared application
presentation components. Details-page consent is bound to the exact displayed
requirements; changing requirements invalidates that reviewed launch consent.

Browser UI requests retain host-assigned origin and document authority. Native
permission, new-window and download callbacks resolve only after core consent;
document replacement cancels stale callbacks. File pickers and native page dialogs
remain platform-owned. Browser exports stage bounded files through asynchronous
ports before the system destination picker. Website notifications have a separate
native delivery path and never modify messaging badges.

Public application manifests use the shared replaceable-event cache by canonical
coordinate, with one latest event per application. Immutable kind-5129 applications
and message references share the event-ID cache. Valid cached releases render
immediately; stale coordinates refresh asynchronously with the application's
relay routing and transport budgets. Only completed lookups renew freshness.
Failed lookups retain usable releases and retry with a bounded delay. Parsed
manifests are memoized within a bounded process cache; browsing caches public
metadata without recording visits or publishing it to the local relay.

Favorites are ordered references from the account's encrypted kind-30267 event,
not a separate membership table. The private-list revision state retains a derived
decrypted snapshot for offline reads and a durable draft for unsigned local edits.
Signing and the existing configuration outbox atomically retire the exact draft
revision. Remote reconciliation cannot overwrite dirty or pending local work.
History remains device-local. Metadata changes preserve favorite order and recency;
database change notifications keep sibling hosts' read models current.
Cross-application action and intent handlers derive membership only from the
current account's favorites. Installations, history and live endpoints do not
grant membership. Dispatch rechecks favorites after target selection;
removing a favorite excludes it from subsequent handoffs without closing its app.
Favorites reads its saved membership snapshot and only the requested metadata
pages. Saved local titles render before first-page manifest verification and
metadata hydration, which run in a later task. Visible signed references missing
local manifests resolve remotely in bounded background workers, allowing each
device to fetch its own artwork without delaying local pagination. Failed
resolutions retain the saved reference and retry on a later Favorites visit.
List navigation never decrypts
events or waits for a signer; configuration synchronization prepares the durable
plaintext snapshot. It does not initialize application runtimes or poll metadata; shared
metadata events update existing entries directly. Runtime initialization belongs
to launch and application-management flows. History changes never invalidate
Favorites membership. History listing has a separate
page-owned reader and is queried only while its page is open, using bounded
keyset pages independently of the Favorites read model. Each entry into Favorites
or History queries its own first page again; account startup does not prepare
either list. Page metadata reads use the current database rows rather than a
potentially stale process mirror.
Application metadata notifications identify one application. Lists replace only
that item's metadata while preserving other item identities, order, recency and
pagination cursors. Sibling hosts invalidate and read only the notified cache key;
table-wide cache notifications never reload these lists.

Running applications pin their launch manifest and loaded resources. New cache
versions update lists immediately, but foreground instances require explicit
restart consent after other approval overlays close. Each target version prompts
once per running instance; a declined update remains available on the next launch.
Accepted restarts await release of the old runtime, its container and capability
connections before initializing the new version. Route-driven and explicit startup
share one in-flight task for the current launch lifetime. Metadata lookups share
network work independently of each caller's lifetime; cancellation stops that work
only after its last consumer leaves.

Application libraries retain their loaded account snapshot across route changes
and share unfinished initialization. Account lifecycle changes discard that
snapshot; visible library consumers restore unloaded snapshots. Local Favorites
reads do not wait behind legacy-library reads.

Discovery queries napp and napplet manifests in bounded pages only from dedicated
relays for each format, without falling back to general-purpose relays. Results are verified
and deduplicated in a temporary catalogue, and share the existing detail
presentation. Independent relay cursors and buffered merging preserve newest-first
ordering as the visible list grows incrementally. Local search reads the verified
fetched catalogue independently of the visible browsing window and never advances
relay cursors. Exact-address search checks cached and saved applications before
resolving a manifest from explicit hints or, when absent, author write relays plus
dedicated format relays. Its bounded account-scoped result cache does not admit
applications to discovery or record visits. Query replacement cancels stale reads.
Browsing never records a visit or writes to the local relay; adding
a favorite persists its event reference independently of history.
Publisher catalogues additionally include nsites from dedicated relays, with an
exact author filter and local authorship verification. Their bounded, temporary results share the
application detail flow without changing saved applications or discovery results.
Application sharing sends only the canonical `nostr:` application reference (or
the URL for unsigned websites), without a title or surrounding prose. Clipboard,
in-app forwarding and separate-window handoffs preserve the same link.
Application reviews are public NIP-22 discussions scoped to the verified
application coordinate or website URL. Their bounded, virtualized read models
stay separate from private messages and mini-app signing grants. Explicit user
posts use the account identity signer; account lifecycle changes cancel reads,
signing and publishing before results can enter a replacement session.

Favorite membership/order is read from the event snapshot; account-scoped
metadata projections and distinct-address history remain separate. Favorites synchronize as a private NIP-51
kind-30267 snapshot through the shared private-list queue, configuration outbox
and self-event intake. A full local draft and dirty revision commit before
background encryption/signing; dirty or signed-pending work blocks remote echoes.
Recency and grants remain device-local. Unresolved references retain membership;
verified metadata hydrates in bounded workers and refreshes one entry at a time.
See [the favorites wire format](protocols/application-favorites.md).
Opening changes recency only. The cache is bounded
by 512 recent addresses plus 512 shortcuts. Existing napplet membership and recency
migrate atomically. Platform website data uses account-specific profiles; removing
an account clears its profile as well as its database rows. Old iOS versions without
named profiles use nonpersistent website data instead of sharing account cookies.
No browser-style forward/back controls are part of Explore.

The in-process local relay stores explicitly submitted, signature-verified public
events in a device-wide SQLite cache without account ownership. Explicit local
submissions, Napp sync and Napp relay/outbox subscriptions populate it;
one-shot remote queries and metadata reads do not. Single-letter tag lookups use a
covering index, and bounded queries filter in SQL before decoding event payloads.
Local subscriptions observe committed additions only and end with their document.
Committed public additions are broadcast between trusted host runtimes through
the platform event port; receiver contexts notify subscribers without re-ingesting
or re-broadcasting events.
Private chat tables and signer credentials never feed this cache; remote relay
connections and AUTH remain account-bound. No WebSocket listener is opened.

## Napplet isolation

Unsigned local napps have account-owned `local~` identities, independent browser
profiles and immutable hashed file versions. Installation commits only after
target-specific access review and an atomic version comparison. Replacements
clear signer/browser authorization in that transaction and invalidate old
documents after commit. Document-owned authorization writes check the installed
version, including across sibling hosts. Failed transitions retain old grants. Local desktop
membership never enters synchronized signed favorites. Local code never gains
the installer's permissions or a fabricated publisher identity.

Napplets run under the current persisted account in a separate platform container.
Changing accounts or locking the application invalidates the execution session
before new work can start. App storage, grants and settings are scoped by account,
verified manifest identity. Upgrades retain storage, configuration and capability
grants; newly required capabilities need fresh consent. Declared optional capabilities remain callable before
authorization, but their first use waits for host consent. Allows and explicit
denials are account/application-scoped; cancellation is not a saved denial.
Concurrent requests share authorization, and no operation runs before consent.
Artifact hashes identify code and cache entries. Runtime relay AUTH connections never borrow the chat session. Identity-signing
leases share the account-owned implementation independently of application relay pools. Only hash-verified immutable
artifacts are shared across accounts. Artifact storage groups files by canonical
application coordinate under `documents/app-artifacts/`, with content hashes
identifying originals inside each application's `files/` directory. The application
directory's outer level is reserved for host-managed materials. See [napplet runtime](implementation/napplet-runtime.md).
Host-owned cache metadata records version file sets and icon locations through
serialized atomic merges. It never supplies signing authority or replaces signed
manifests; runtime files remain hash-verified.
Website artwork is indexed by canonical origin in a separate website directory.
Local display files survive restarts; refreshes retain usable artwork and use the
same bounded public-resource transport as application downloads.
Mini-app desktop membership and position are explicit account-scoped state,
independent of launch recency. Desktop edits commit atomically and never change
app data or grants. The recent preview shows one row; full recent history derives from the bounded
installation library.
Signing authorization belongs to the shared signing service, independently of app
storage. Event rules bind an account, a host-verified source, operation, event kind and
an optional `scope_key` qualifier. Addressable events derive that qualifier from
the actual d tag; other operations may use their own trusted scope identifier.
Public-key access and NIP-04/NIP-44 encryption/decryption use the same authority
service with separate method scopes, independent of the cryptographic peer. Every
call uses the current verified source. Launch access never bypasses signer
authorization, and revocation invalidates pending results before disclosure.
Approvals are committed before invoking the signer; signer latency does not
expire them. Remembered rules have no per-source count or aggregate-size quota.
Signing, publication and local event ingestion share NIP-01 structure validation;
transport and cache budgets do not define event validity.
Sources are canonical naddr IDs or host-verified HTTP(S) website origins (scheme,
host and effective port), without a source type or code version; immutable legacy listings use canonical event IDs. Durable rules and a
bounded metadata-only activity journal have separate tables. Session grants stay
in memory. Relay AUTH and public-file uploads use explicit signer permissions
with Once, timed and Always decisions. Relay AUTH grants cover all relays for
that account/source and leave `scope_key` empty; upload grants retain reviewed
storage destinations. Legacy relay-specific AUTH decisions merge to the newest
active decision per account/source, with denial winning timestamp ties.
File metadata accompanies upload review, and its authorization covers the
host-built storage authentication event. Upload bytes, temporary files and
status belong to one execution session; stopping it cancels uploads and cleans
staged files. Migration retains a read-only backup of old app namespaces and
imports only rules whose scope can be preserved exactly. Host-owned approval IDs
bind responses to one request; cancellation invalidates queued approvals before
a session is replaced.
Authorization work is serialized by account and verified source across signer and
browser permission controllers. A decision settles after sheet dismissal, and
the next request reads authority after that decision has committed.
Each source queue has one worker. Canceling a waiting request removes only that
entry; canceling the active caller does not release its processing slot until
the active work finishes.
Signing revocation invalidates cached approvals and in-flight signatures, then
serializes persistent removal without stopping unrelated executions. App access
changes restart the affected container. Host overlays block app input through
their full exit. Mobile modals retain the live page underneath; Electron replaces
its elevated native view with an ephemeral renderer preview while the sheet is open.
Shared sheet/dialog presentation lifetime covers every embedded application,
including overlays opened outside the application runtime. Electron hides the
native view immediately rather than waiting for preview capture or image decoding.
Sharing is an embedded host flow: the execution container remains mounted but
hidden, background consent waits until the picker closes, and sending never
navigates to a destination conversation.

Details-page launch consent stays in the prepared run state and applies only to
the reviewed required-capability set for that account and artifact. It is never
carried in route parameters; direct launches still check persisted permissions.

Electron application windows are trusted leaf hosts with independent runtimes and
overlays. They share the asynchronous database and account-bound website profiles,
without starting messaging or notification services. Container IPC belongs to its
actual host window; closing or replacing one host never stops another. Persisted
signing changes invalidate matching approval caches across hosts. Locking, switching
accounts or removing their account closes these windows. Sharing and publisher
navigation return to the main host. Session-only grants remain execution-local.

Napp action handlers and INC endpoints belong to authenticated documents under
one account. Electron brokers cross-window messages in its main process; mobile
keeps a bounded stack of live calling containers behind the foreground handler.
Only trusted hosts assign endpoint metadata. Teardown cancels action requests and
closes communication channels. Configuration shares account/source persistence;
cryptographic requests obtain method-scoped signer authorization using the identity
signer, never the messaging key.
Napp launch access includes ordinary web networking, independently of whether
the signed manifest explicitly names it. This effective requirement participates
in the same visible consent and persisted-grant checks as declared access.

Browser capability decisions live separately from signing grants in
`browser_authorizations`, keyed by account, verified source, and individual
resource. Website sources use the current document origin; signed applications
use their canonical address. One-time access lasts for the current document;
timed and permanent allow/deny decisions persist. Platform permission-check
leases never outlive the saved expiry, navigation, or a permission-change
invalidation. Reset clears both capability and signing decisions. Persistence
and ordinary clipboard writes need no consent sheet; capture selectors and
unknown resources never create reusable grants.
