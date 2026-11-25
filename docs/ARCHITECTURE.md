# PsstPsst architecture

System boundaries, owners of durable state, and invariants across subsystems.
See [protocol specifications](protocols/README.md) for interoperability and
[implementation notes](implementation/README.md) for local behaviour that
needs explanation beyond the code.

## 1. System shape

PsstPsst shares application code across iOS, Android, and Electron. React
Native Web is an Electron renderer detail. Standalone web is outside the
supported runtimes. User-facing branding is `PsstPsst`. Application identifiers,
internal namespaces, and artifact prefixes use `psstpsst`. Development and
production have separate installed identities, permissions, URL schemes, and
local state. Only production consumes production updates.

## 2. Layer boundaries

- **UI.** `src/app/` and `src/components/` read through hooks and React stores
  and start work through services. Raw database handles stay out of UI code.
  Prefer UI dependencies that also work on React Native Web.
- **Core.** Services, database, libraries, stores, and localization are
  platform-free. Direct Expo and React Native imports are restricted to the
  exceptions in ESLint. Services never import UI modules. Service-owned session
  state uses vanilla stores in the service layer with React bindings in
  `src/stores/`.
- **Platform.** Start new OS capabilities with an interface under
  [`src/platform/ports/`](../src/platform/ports/), implement and register the
  required adapters, and consume through `platform` from `@/platform`.
  Ports return promises except for documented probes, listener registration,
  cached reads, and pure computation. Select adapters before routes or services
  evaluate. Electron installs its adapters from the preload bridge.
- **Live queries.** Import `useLiveQuery` and `useMigrations` through
  `@/db/use-live-query`. That seam owns the runtime-specific Drizzle binding.

## 3. Persistence and account lifecycle

- SQLite owns durable non-secret application state. Account-owned rows are
  scoped by `account_pubkey`. Keep database access asynchronous from the UI,
  including SQLite operations in Electron's worker. Use transactions for
  related writes and bounded batches for large reads.
- Device preferences, account-local state, and relay-synchronized state have
  distinct owners. Electron's main process owns boot-time window and updater
  metadata, independently of renderer startup. Credential storage belongs to
  the vault.
- Startup storage upgrades run after database setup and vault unlock, before
  preferences, account bootstrap, or notifications. Preserve existing
  credentials and ownership, keep interrupted migrations retryable, and remove
  old data only after the replacement is durable.
- One account is active in the host UI. Account changes invalidate its work,
  subscriptions, runtime sessions, and decisions before the next session uses
  them. Guard late completions at write boundaries. Account removal also
  deletes scoped rows, secrets, archives, and managed data. Shared assets stay
  while another account or device-owned library still references them.
- Versioned archives preserve message ownership. Nearby ownership uses the
  proximity identity and its perspective in the archive. Validate archive
  contents and ownership before import. Export includes only locally available
  files and never fetches remote bytes.

## 4. Messages and conversations

- The authenticated inner rumor is the canonical immutable message. Transport
  envelopes supply relay delivery and verification. Conversation, attachment,
  reply, reaction, and archive logic use the rumor. Compose and send through
  the shared conversation target so callers preserve contact, group, and
  Nearby semantics. See the [messaging protocols](protocols/README.md#private-messaging).
- Deduplicate by authenticated event ID. Use shared chronology throughout
  paging, read watermarks, state replay, previews, and notifications. A
  larger `order_at` is newer. At equal times the smaller event ID is newer.
- Conversations are read models. The last-message ID and both conversation
  timestamps follow the same message, or the creation timestamps when there
  is no preview. Update them atomically. Draft and metadata writes do not
  change chronology. Incoming reactions to the local author's visible messages
  have a separate device-local preview cursor. Only arrival intake advances it.
  Viewing the conversation clears the pending flag while retaining the cursor.
  Retracting a reaction clears the pending flag and any queued notification
  for that event while preserving a newer preview. Reactions leave ordinary
  unread counts and list ordering untouched.
- Relay direct chats key by counterparty. Relay groups key by a hash of the
  stable group ID. Nearby rows preserve their owning local proximity identity.
  A conversation key alone does not identify a recipient or establish write
  authority. See [group messaging](implementation/group-messaging.md) and
  [Nearby messaging](implementation/nearby-messaging.md).
- Conversation acceptance and per-resource media consent are independent.
  Contacts, requests, and saved groups have distinct lifecycles. Mute changes
  presentation, while blocking acts at intake according to the conversation
  type.

## 5. Relay routing and configuration

- A connected network link can reach LAN relays even when the Internet
  reachability probe fails. Relay sockets and delivery workers use link state
  for offline gating.
- `relay-router.ts` owns routing. Discovery, public outbox, and private inbox
  routing serve distinct purposes. Read/write relay declarations stay
  independent of DM inbox settings.
- Use the shared managed transport for queries, subscriptions, and
  publication. Normalize addresses for identity and reuse. Preserve signed
  tags. Keep caller cancellation scoped to that caller and retain failure
  separately from confirmed empty results. Publish outcomes distinguish relay
  refusals, rate limits, and transport failures. EOSE settles the initial query
  phase while live subscription ownership continues. Keep each relay's
  settlement reason. History coverage accepts wire or timeout EOSE and
  leaves gaps after connection, closure, or authentication failures.
- Deduplicate metadata work by canonical identity and keep caches bounded.
  Preserve usable cached metadata on failed refresh. Query timelines own
  in-memory cursors and do not establish durable message history coverage.
- Local private-list edits and their sync revisions commit atomically.
  Reconciliation must protect dirty or pending local work. Configuration
  publication and message delivery have separate account-scoped outboxes. Relay
  and Blossom settings take effect from durable local edits before signing and
  publication.
  See [configuration publication](implementation/configuration-publication.md).

## 6. Message lifecycle and notifications

- Commit outgoing rumors with durable work before signing or publishing.
  Admission checks authority and freezes the recipient set. Resume interrupted
  work without duplicating timeline entries or retracting settled delivery.
  Message status is a persisted summary, with recipient detail loaded on demand.
  See [relay message delivery](implementation/relay-message-delivery.md).
- Start relay intake only with reconciled routing and the announced local
  messaging key, subject to the bounded first-local-account bootstrap.
  Key changes invalidate stale sessions and background work. Share validation,
  decryption, and storage across live, backfill, recovery, and APNs intake
  with explicit account and arrival context.
- Durable history coverage is per account and relay. Advance frontiers only
  after completing history work and checkpoint progress for interruption.
  Live reconnect and notification polling cover recent gaps without updating
  history frontiers. Group action finality uses the conservative intersection
  of configured relay coverage. See [history and recovery](implementation/notification-recovery.md).
- A successful message insert owns arrival eligibility. Atomically enqueue
  eligible notifications with the write, recheck policy and current message
  state at claim, and deliver best-effort after claim. Historical work stays
  silent, including later promotion from quarantine. A request can alert on
  its first real message only. Deletion and resurrection preserve that
  distinction. A valid incoming reaction to the local author's visible message
  can alert while its reaction preview is pending, independently of message
  unread state. Recheck the reaction before presenting a claimed aggregate.
  Quiet hours suppress system delivery without catch-up.
- The unread total is a database-derived, service-owned read model shared by
  UI and badges. Presence gates automatic read advancement and foreground
  delivery. The currently viewed conversation stays out of that total while
  the user is present. Background intake and recovery must work without a
  mounted React surface or foreground-only UI timers.
- On iOS the app and extension serialize shared database writes and check
  account ownership inside the transaction. The extension has only restricted
  messaging credentials. See [iOS notifications](implementation/ios-push-notifications.md).

## 7. Large-history performance

Design for histories with up to a million messages. Consider data size,
frequency, and downstream invalidation before changing a hot path.

- Use bounded indexed queries and independent chronology cursors. Update
  retained data and indexes incrementally. Virtualize rendered rows and fetch
  only new pages, bounded tail overlap, and needed referenced records.
- Retain loaded pages across live-tail and anchored views in the same chat
  session. Query older and newer history from their own edges. Batch
  out-of-window reply lookups with their source page so scrolling starts no
  additional reply lookups. Search opens a bounded window around the result.
- Keep volatile input state local. Subscribe rows to the state they display.
  Use bounded caches and in-flight deduplication for expensive shared work.
- Keep synchronous database, crypto, and bulk transformation work off the
  UI path. Commit immediate feedback first. If short synchronous work is
  unavoidable, yield to a later macrotask so a frame can paint. Use chunks,
  workers, or native execution for sustained computation. Awaiting synchronous
  work or a resolved promise does not unblock rendering.

## 8. Attachments and Nearby

Media servers receive ciphertext. Verify supplied integrity data, stage
resumable bytes separately, and publish managed plaintext only after successful
verification and decryption. Scope download ownership and consent to the
account and resource. Identical attachment downloads share a task across
messages; the initiating message supplies the mirror lookup hint. Cache lookups cannot trigger a remote download. Deduplicate
managed files and release them by reference. Lists and archives consume local
metadata and files without eagerly loading remote attachments. For an HTTP(S)
attachment that cannot be downloaded from its original URL, use the message
author to look up their signed Blossom server list (kind 10063), regardless of
which relay delivered the message. Use the shared peer metadata query and
replaceable cache: cached results (including misses) return immediately, stale
rows refresh in the background, and only a cold miss waits for the relays.
Try those servers in order using the ciphertext hash from the event or a
hash-named URL path. Local Blossom servers are valid. The receiver's own upload
settings are not download hints. Once ciphertext has downloaded, hash or
decryption failures do not trigger a different server,
including for `blossom:` attachments. A hash mismatch blocks viewing,
sharing, and saving; there is no override.

Pending upload state belongs to services and survives route changes. Persist
staged external shares independently of the OS share grant. Shared uploads
stay active while a recipient needs them, and terminal cleanup cannot restore
a completed send as retryable work.

Nearby separates advertising presence, authenticated session liveness, and
durable peer consent. Noise state and keys stay in native or worker code behind
opaque async handles. Nearby file exchange binds the offered bytes to the
authenticated peer and keeps BLE plaintext and remote ciphertext partials
independent until verification. See [Nearby implementation notes](implementation/README.md#nearby).

## 9. Navigation and overlays

One Expo Router state drives narrow and split layouts. Resizing preserves the
active session. Check route availability at dispatch and discard stale events
from closed sessions. Validate one bounded, already-decoded scalar for each
identifier using the shared [route parameter helpers](../src/lib/navigation/route-params.ts)
before starting queries or work. Credentials, media payloads, and browser files
stay out of route parameters.

Serialize native modals using their close callback. Keyboard, gesture, and
safe-area providers survive account gates. An independent application surface
owns its own keyboard and input callbacks.

## 10. Trusted runtime and credential custody

- Electron isolates and sandboxes renderers. The preload bridge exposes typed
  operations. The main process validates privileged input. Native modules
  and workers keep privileged storage, cryptography, and file access behind
  platform boundaries.
- The vault owns identity, messaging, Nearby, remote-signer, and wallet
  credentials. Expose narrow operations and public results. Generic storage
  and crypto bridges cannot use vault namespaces or bypass key-purpose checks.
  Retained messaging keys and Noise state stay inside their owning boundary.
  Desktop secrets use OS protection or a password-protected encrypted vault.
- Migrate legacy secrets inside their trusted boundary. Fill only missing
  credential bindings, preserve existing peers, and durably prevent legacy
  credentials from being reimported after migration. On iOS only the main
  app migrates old Keychain records. The extension can access only the
  dedicated messaging group.
- Account signing uses revocable `Signer` leases. Closing one consumer releases
  its lease, while ending the account session invalidates outstanding work.
  Persistent credentials change only through explicit account or credential
  lifecycle operations. Remote signing uses a dedicated relay pool.
- Key backup, outgoing key transfer, unlock, and payment authentication use
  trusted platform surfaces. Backup copies the key inside that boundary.
  On iOS the backup copy is device-local to prevent Universal Clipboard sync.
  Review copy and sensitive values stay under trusted ownership. Transient
  credential import returns public metadata only.
- Wallet debits require invoice-bound authentication. Claims guard replay
  across wallet and application data changes, and uncertain results are not
  retried automatically. See [WebLN](implementation/webln.md).
- Diagnostics are bounded, sanitized, local by default, and exported only by
  explicit action. Keep message content, identities, credential data, and URLs
  out of diagnostic records.

## 11. Embedded applications

- The host verifies the application identity and assigns document and account
  lifetime. Website authority is bound to the verified HTTPS origin and
  committed main frame. Signed apps verify manifests and content. Navigation,
  revocation, and account changes invalidate stale capabilities and results.
  Serialize host reviews and recheck authorization at dispatch.
- Use canonical `eventKey` for event-based application identity. Exact release
  lookups and artifact validation use event IDs. Website, local installation,
  and provisional host identities have separate scopes. Reconcile provisional
  hosts when verified metadata arrives.
- Membership, history, installation, live instances, and permission grants
  are independent. My apps derives from the account's encrypted snapshot
  and durable draft. Visits remain device-local. Catalogue and address lookups
  can cache public metadata without recording a visit or publishing an event.
- Running instances pin their launch artifacts. Reopening an active app
  focuses the account/source-owned host, and replacing its version first
  tears down the old document and authority. The local relay accepts explicit,
  validated public submissions and stays isolated from chat and secrets.
- Application relay connections, including authenticated connections, are
  scoped to the account and application network. They cannot use the chat or
  remote-signer relay pools.

See [runtime notes](implementation/napplet-runtime.md) and
[application contracts](protocols/README.md#embedded-applications).
