# Napplet runtime

PsstPsst hosts HTML napplets, including embedded single-threaded WebAssembly,
under the currently selected account. There is no guest account or DM capability.
The third primary tab is a home screen: a single recent-app row above an
explicitly ordered desktop, both inside one virtualized vertical list. Each account
owns its desktop positions, recent usage, installations, settings, permissions and default intent handlers.

## Protocol baseline

- NIP-5D PR 2303, `020cb8b33a9e4c6b8ca4b2f9d0ed0a67843b68f7`.
- `@napplet/shim` 0.32.0, with core/nap 0.34.0 locked by package-lock.json.
- NAP-OUTBOX PR 32, `8865f73d52a4864afee145f28d26520476273927`.
- NAP-STORAGE PR 3, `4f4cf0ca7ecbd24c284a5d63bcd85e3de6af37ca`.
- NAP registry: <https://github.com/napplet/naps>.

These proposals are drafts. Domain availability is not a declaration of complete
conformance to every evolving proposal. The host implements shell, theme,
storage, resource, link, identity, relay, outbox, upload, intent, inc and config. Unknown
messages and application-supplied reply envelopes have no authority.

The document exposes supported, declared optional interfaces even before a grant.
The host gates execution, shares concurrent requests for one capability, and
serializes decisions by account/source with signing and browser authorization.
An Allow persists the domain and resumes the original call without reloading.
Declared optional `theme`, `storage` and `config` access defaults to enabled in
both execution and permission management. Explicit denials override these defaults;
turning off a default-enabled switch records a denial even without a saved grant.
Reject persists the domain in `permissions/denied-domains`; later calls fail
without review. Cancellation and timeout fail only the pending call. Disabling a
previously granted optional capability in management records rejection; enabling
it clears rejection. Reset clears grants and denials. Undeclared domains fail
without prompting. SDK request budgets cover the bounded approval queue, and
upload byte-transfer deadlines start after access review.
The generated SDK adapter rejects host error responses before reading success-only
payloads, including identity public keys, configuration values and INC channel
lists. Settled requests release their timeout and pending entry immediately.

The reader supports standalone and legacy single-file manifests; see
[manifest formats](../protocols/napplet-manifests.md). Legacy required domains
remain required, and an unavailable domain still prevents installation.

## Ownership and lifecycle

`nappletService` owns the vanilla store, catalog connection, permission prompts
and single foreground execution session. React bindings live in `src/stores/`.
Account lifecycle invalidates the session before changing identities. Application
lock and route blur stop execution. Selecting a different account resets the
mini-app page to Recent. Stopped sessions abort requests and discard
late results; their connections, signer, INC endpoint and native container close.

Entry points synchronously prepare an account-bound launch and navigate to its
container before starting installation, authorization or artifact loading. The
details page always uses Open, with required access expanded above a fixed bottom action. Optional access is omitted from app details.
The container starts that work after committing. Verified local code loads on a blank
themed canvas; a missing or corrupt artifact enables the icon and loading state
only when a network download is needed, retaining it until the first frame.
The container presents recoverable errors with retry,
and cancels its own run on exit. Run ownership prevents a departing route from
stopping a newer launch selected in the persistent primary pane.

The trusted wrapper signals presentation readiness after its iframe loads and
crosses a paint boundary. Mobile keeps the surface hidden until that signal.
Electron reveals the loaded document at its first valid visible bounds because
hidden WebContentsViews suppress frame callbacks, even without background
throttling. Input stays blocked until the private readiness signal, then normal
background throttling resumes. This signal is independent of application NAP
capabilities and cannot be forged by app messages.

On mobile, native modals already composite above the embedded WebView, so host
sheets block app input without hiding its painted content. Electron's separate
WebContentsView would cover renderer-owned overlays. It is replaced with an
in-memory page preview only after that image has painted; the live view returns
before the preview is cleared. Previews are bounded, scoped to the mounted
container, and never persisted or exposed through application APIs.

System Back first traverses the container's browser history, delivering the usual
`popstate` navigation to the app. Only a container at its history root closes.
Host overlays retain Back priority, and the leading Close action always exits.
This uses browser navigation rather than introducing a NAP protocol extension.

The manifest identity includes publisher and kind. Named manifests additionally
include the opaque `d`; snapshots use their signed event ID. Application KV,
configuration and capability grants bind account and manifest identity across
upgrades. Instance KV stays in memory. Migration 61 merges known current and
previous namespaces, preserves unresolved values in a read-only backup, and
rebuilds per-bucket quota counters. New configurations retain valid saved fields
and apply defaults for added or incompatible fields. Code rollback retains the
same user data.

Desktop positions are independent of last-used timestamps. New launches enter
the recent preview; its menu adds one desktop shortcut, and moving
it updates only changed slots in an account-scoped transaction. Shortcut removal
preserves recency, app data, permissions and default intent handlers. Shared immutable artifact files are hash-verified before execution and kept
in the managed documents directory. They contain no account credentials.

## Platform boundary

The napplet port provides bounded public HTTPS resource reads and container
operations. Android and iOS use the local ExpoNapplet module. Its native view
loads a trusted wrapper containing an opaque-origin `allow-scripts` iframe.
Native message handlers accept only the wrapper's main frame. Reply commands go
directly to the native view rather than rebuilding a React prop queue.
Android serves the wrapper from memory at a unique synthetic HTTPS URL. Only that
main-frame request and local data resources are admitted by the WebView client;
the app's opaque iframe keeps the restrictive CSP and has no direct network access.

Electron uses an independent WebContentsView, nonpersistent session and minimal
preload. The existing application preload is never installed in an app frame.
The isolated profile only serves its immutable wrapper URL and blocks other
network requests. The wrapper checks MessageEvent.source before forwarding.

CSP prohibits direct app network access, workers, nested frames, form submission
and external executable resources. WASM byte compilation is allowed without JS
string evaluation. Resource replies become local Blobs. SVG is decoded into a
bounded PNG in the trusted, network-restricted wrapper and never delivered raw.
This raster path uses the container's image decoder, rather than the draft's
suggested worker implementation.

Resource requests use no cookies or account credentials. Artifact SHA-256 uses
the existing off-thread device-crypto port; bridge codecs, UTF-8 decoding and
document preparation yield between bounded chunks. Each transport checks
DNS in the actual connection path; iOS pins the numeric connection target while
retaining hostname TLS verification. Redirects are rejected.
Android, iOS and Electron retry non-public system DNS answers through
Cloudflare or Google DNS over HTTPS using pinned bootstrap IPs. Only independently
resolved public addresses are admitted; TLS still verifies the original hostname.
This supports Fake-IP VPN DNS without allowing access to private endpoints. The
fallback cache is bounded and expires within the DNS TTL or 60 seconds.
Requests, byte sizes and concurrency are bounded. HTTPS, Blossom and data URLs are implemented;
other schemes return an unsupported-scheme error. Bulk requests accept the pinned
SDK request objects and legacy URL arrays, preserve successful siblings, and
bound aggregate reply size and total request time.

Downloaded code, bundle files and declared icons live in
`documents/app-artifacts/<app-id>/files/`, named by content hash with `.html` or
`.blob` extensions. Host-generated materials belong directly under `<app-id>/`.
The directory ID is the canonical relay-free `naddr` (or `nevent` for
immutable legacy listings), so updates retain the same directory. IDs exceeding
240 characters use `app-<sha256(app-id)>` with the full ID in `app-id.txt` to stay
within filesystem component limits. Earlier files stored directly under
`<app-id>/` or in the flat `documents/napplets/` cache are hash-verified and copied
into `files/` on demand, without scanning or deleting the old cache.
Account-specific data and grants remain in their separate stores.

Each application directory contains a host-owned `metadata.json` with
`schemaVersion`, the full `appId`, `versions` keyed by signed manifest event ID,
and an optional `icon` record. Version file lists contain relative hashed paths;
`complete: true` is committed only after all required files are ready. Missing
`complete` means preparation is incomplete, and retries cannot downgrade a
completed record. Icon records contain the source hash, source manifest ID and
relative source-file path; they do not imply that a display thumbnail exists.
Bundle preparation updates metadata at its start and completion, rather than
after every file. Atomic object merges preserve other versions and concurrent
icon changes. Electron serializes these operations in the main process; mobile
serializes them in the shared adapter and performs replacement off the JS thread.
Metadata is a rebuildable cache index, never an authority for runtime code or
permissions. Display-image generation and automatic artifact collection are
separate consumers of this index.

Website artwork uses `documents/app-artifacts/website-<sha256(origin)>/`, with
the canonical scheme/host/port origin as `appId` and `origin` in `metadata.json`.
Its icon record stores the discovery URL, source-content hash, relative display
path and optional HTTP validators; `checkedAt` and `refreshAfter` govern refresh.
Displayed artwork is read directly from local files, without rehashing or base64
encoding pixels on every launch. Native image conversion produces a PNG bounded
to 256 pixels on either dimension; formats unsupported by a native converter
retain their original extension for the image view.
Successful fetches remain fresh for 24 hours. Stale artwork is returned before a
background refresh; ETag/Last-Modified conditional requests reuse it on 304.
Missing/moved icon URLs fall back to bounded HTML/manifest discovery. Network
failures retain existing artwork and defer retries for five minutes, including
across restarts. Website discovery and refresh share a four-job pool and a
64-job waiting bound; the in-memory origin index is capped at 128 entries.
New files are staged before publication, metadata is replaced atomically, and
the previous icon is removed only after the new record is published. Mounted
identity rows receive refresh notifications; decoder failures retry missing or
corrupt local files with a bounded recovery interval. Older native/preload
transports fall back to full bounded downloads when response metadata is absent.

## Runtime controls

The runtime header exposes More and Close. More opens app identity and publisher
information, with Share, Permissions and Reload actions. Permissions replaces the
sheet body with account-bound permission management without navigating. Sharing hands a stable Nostr
app address to an embedded instance of the existing recipient picker after the
host sheet closes. The app container stays mounted and hidden; completion or
cancellation returns to that container, even for multiple recipients. Background
approvals wait without a review timer until sharing ends. App
references in messages open the app detail flow. The permissions page lists required access,
editable optional domains, and account-and-application signing rules. Optional access
changes reload the container; individual signing rules can be revoked live.
Rule editing preserves the exact operation/kind/record/recipient/server scope and
serializes changes to decisions and expiry. Selecting Ask removes automatic
authority immediately after saving. Its row is retained only by the focused
permission view; leaving the page, switching accounts or changing the artifact
discards that display state. It is never persisted as a permission.
Management, configuration and signing prompts share one host sheet, with consent
taking priority. App input remains blocked through the host sheet's exit animation.

## Nostr operations

Scanned addresses and manual input use the same account-bound lookup. It first
matches verified installed and catalog manifests by exact event ID or full
kind/publisher/identifier coordinate. Local hits do not open relay connections;
remote hits join the bounded catalog cache. Explicit update checks bypass the
local cache.

On a local miss, app-address lookup queries embedded relay hints alongside the market relays using
the exact kind, author and case-sensitive identifier, with a one-event limit.
For pointers without relay hints but with an author, a miss falls back to that
publisher's public NIP-65 write and unmarked relays. Relay-list metadata is sought
on the market and standard discovery relays. Failed or rejected reads and invalid
manifests are not reported as a completed lookup with no matching app.
Each address lookup owns a bounded, disposable relay reader, so browsing different
publishers does not exhaust a long-lived app's destination budget. Account changes
cancel these readers before any result can reach the next account.

Runtime relay clients reuse ManagedRelayPool behavior, with independent public,
authenticated and NIP-46 transport pools. They never borrow the chat pool's AUTH
state. Reads are bounded and signed events are verified. OUTBOX resolves author
write relays; publication combines own write relays, explicitly requested relays
and required recipient read relays. Missing required recipient routing fails.
Live OUTBOX subscriptions refresh routing and retain bounded deduplication state.

Signing permission is separate from NAP domain access. Initial access grants the
required domains; optional domains start disabled and can be selected individually.
The host queues at most 16 approvals, shows one at a time, rejects stale approval
IDs and cancels requests on session termination. Each approval receives 60 seconds
when it becomes visible; queued requests have no running review timer. Explicitly
rejecting the whole queue pauses prompts for one minute or until the execution
session ends. Routing and post-approval signing each have a 25-second budget; late
remote signatures are discarded without publication. The injected pinned OUTBOX
shim extends only publication waits to 1020 seconds to cover the bounded queue
and these execution budgets.

Requests default to one-time approval. The user can remember a timed decision
(10 minutes, one hour or 24 hours) or a permanent decision, then Allow or Reject.
The shared signing service owns rules independently of app KV and UI. Its source
is the canonical naddr for an app, or a host-verified HTTP(S) website origin (scheme, host and effective port); immutable
legacy manifests use a canonical event ID. Each durable row binds the account,
source, event kind and addressable d tag. Signer-access rules additionally distinguish
methods and crypto algorithms, independently of the peer. Relay AUTH covers all
relays for the source; upload rules bind their destination set.
There is no artifact-version condition. Only exact-scope version-3 publication
rules are imported from the legacy KV backup. A broader migration never follows
from dropping a legacy condition.

Custom kinds retain generic descriptions. Session decisions remain in memory.
Rules are limited to 64 per account/source and timed decisions expire on every
use. Durable writes finish before the approval becomes effective. Revocation
invalidates all live sessions of that account/source and any pending approval or
unpublished signature. Resetting app access stops its container and clears its
capability and signing rules. Upgrades preserve both data and authorizations;
additional required capabilities need consent, and new optional capabilities stay
off. The separate activity journal retains the latest 32 metadata-only decisions
per account/source, without event bodies or a claim of publication success.
Relay AUTH and public-file uploads use the same Once, timed and Always permission
flow. AUTH grants cover all relays for the account/source; uploads retain the
reviewed storage destinations. Permission qualifiers live in `scope_key`: current
addressable events use the d-tag value, and global AUTH uses the empty qualifier. Upload review includes
file metadata and authorizes the host-built Blossom authentication event.

Authorized publication signs once and reports per-relay outcomes.
All valid event kinds and app-data identifiers can reach user-approved generic
publication, including account settings and protocol events.
Consent expires 60 seconds after presentation; submitted timestamps are
retained when valid, with future timestamps limited to one day. NIP-44
publishEncrypted is available; NIP-04 is not. This API does not expose messaging
keys, decrypted chat histories, wallets or arbitrary signing primitives.

IDENTITY reads public Nostr projections. It never substitutes private PsstPsst
contacts or blocks. Unsupported identity projections return an explicit error.

## Composition and settings

UPLOAD provides `info`, `upload`, `status` and status notifications through the
pinned SDK. Blossom is enabled; NIP-96 is explicitly unavailable. File size is
governed by the Blossom server; the host advertises no maximum and imposes no
per-execution byte allowance. Two transfers/jobs may run concurrently.
The trusted wrapper accepts structured-cloned Blob/ArrayBuffer values and uses
credited, bounded chunks across native JSON bridges. Apps cannot select local
paths, credentials or destination servers.

The host uses the current account's media-server upload plan, including its
fallback. Public-file consent shows filename, MIME type, size and candidate
storage services. Upload permission offers Once, timed and Always choices for
that application's reviewed destination set, independently of ordinary event
signing. Upload capability access is still required. A host-built
kind-24242 authorization covers only the computed SHA-256 and size, expires after
five minutes and never reaches the app. Generic publication of Blossom or
NIP-98 authorization events is also available under its own event-signing rules.

After approval, unchanged bytes are staged through the existing asynchronous
filesystem port and sent through the shared Blossom backend, without background
mirrors. Preserving bytes also preserves embedded metadata, which the consent
notice explains. Results contain host-checked hash, size, MIME type, public URL
and NIP-94 tags. Server hash/size mismatches fail. Pending/uploading/terminal
statuses and progress are endpoint-local; completed history is bounded. Jobs time
out after two minutes. Upload-access changes, account changes and container closure cancel
in-flight work, suppress late replies and delete staged files.

INTENT routes exact convention identities to verified installed handlers under
the same account. The user can choose once or save a default. Cold deliveries
remain buffered until the target shim is ready. Acceptance means responsibility
for delivery, not proof that an application has processed the task.

INC topics and channels are scoped to authenticated live endpoints under one
account. Channel opening checks both endpoint lifetime and host authorization.
The single foreground policy means a stopped application's endpoint is unavailable.

CONFIG supports bounded objects, arrays and scalar values, enums, defaults,
required properties and basic number/string bounds. Remote references are not
loaded. Settings are edited using host UI and validated before persistence.

## Verification

Run the napplet Jest suites for manifest validation, account-bound handlers,
late-result rejection, intent envelopes and INC isolation. The browser test uses
the actual injected shim and verifies opaque origins, denied direct network and
browser storage, mediated resource replies, SVG rasterization and WASM execution:

```sh
npm run test:napplet-browser
```

It uses installed Chrome on macOS or Playwright Chromium elsewhere. Set
`NAPPLET_CHROME` to select another executable. Native changes require a native
rebuild; Expo Go does not supply this module.

With a connected Android device and the generated Android project, run the native
WebView integration test. It uses the shipped wrapper and shim to check loading,
identity request/reply, local images, WASM and sandbox isolation:

```sh
cd android
./gradlew :expo-napplet:connectedDebugAndroidTest -PreactNativeArchitectures=arm64-v8a
```

The host bounds installation libraries to 512 entries, resolved metadata to 500,
and keeps recent usage on a dedicated history page. That page derives used apps from
the already-loaded installation library and virtualizes their list. It bounds
filters to eight with at most 200 events per filter, routed authors to 16, and a
runtime's connection cache to 24 relay destinations. Active readers and publishers
hold shared destination leases; completed requests release them. New destinations
evict only idle entries, including their connection records. Finite requests wait
in a bounded, cancellable queue when every slot is active, within their original
deadline; the number of historically visited relays is not a lifetime quota.
Queries use the shared pool's per-relay concurrency queue. Query and live-event buffers are byte-bounded;
live delivery yields between batches. A process-level lifecycle observer retains
only live relay pools. Verified manifest metadata and public icons are cached so
reordering a shortcut does not repeat settled cryptographic work.

Additional checks:

```sh
npm run test:napplet-electron
npm run test:napplet-gallery
npm run test:napplet-signing
npm run test:napplet-database
```

## Explore integration

The Explore start page reuses the responsive icon grid and menu interactions for
napplets, napps, nsites and websites. Its address entry accepts canonical Nostr
addresses and HTTP(S) URLs without introducing a browser navigation toolbar.
Legacy napplet routes remain valid for shared links and capability management.
Discovery and publisher catalogues query napp kind `35130` only on
`wss://relay.nostrapps.com/`, napplet kinds `5129`/`15129`/`35129` only on
`wss://relay.napplet.soy/`, and nsite kinds `15128`/`35128` only on
`wss://relay.nsite.lol/` and `wss://relay.nosto.re/`. Discovery omits the nsite
sources; publisher catalogues retain them. Format queries run concurrently;
failed sources mark the result incomplete without discarding other formats.
Each format uses one filter containing its supported kinds with `limit: 200`.
Discovery delegates raw event pagination to `src/services/relay/relay-timeline.ts`.
It accepts `{ urls, filter }` subrequests and an injected query callback, retaining
an independent inclusive `until` cursor and verified buffer per relay/query pair.
Buffer heads merge by descending event time with event-ID tie breaking and
adjacent-ID deduplication. Cancellation rolls back uncommitted cursor progress.
Discovery parses each fetched batch once and incrementally merges verified
application coordinates into a searchable in-memory catalogue. A bounded event
parse cache avoids repeating verification for buffered events. The visible list
reveals 20 additional applications per scroll page; local name/description/publisher search
includes fetched applications beyond that visible window, also reveals 20 matches
at a time, and never advances relay cursors. Publisher names use the shared batch
profile/contact hooks, including local petnames; asynchronous metadata updates
automatically update active search results. Clearing search restores the browsing
window. A depleted source is
refilled before exposing older buffered results from other sources. Duplicate
application coordinates retain the first (newest) release; consumed pages are
replaced instead of re-sorting the accumulated list. Refresh resets the cursors
and visible window. Failed reads retain displayed content and stop automatic
loading until refresh. A full, duplicate-only timestamp boundary also stops with
an error rather than skipping unseen same-second events, since fixed-size NIP-01
filters cannot exclude already-seen IDs.
Explore's header uses the shared QR scanner. The home scanner classifies application
naddr and website URLs with the same pure parser, then sends an account-scoped,
one-use in-memory handoff to the Explore tab; only the handoff ID enters route
params. Explicit Lightning/LNURL endpoints retain their payment routing, and legacy
note/nevent app pointers retain their existing detail route. A valid naddr/URL scan seeds
the shared search field without changing the selected Favorites/Discover scope
or starting a background catalogue read,
reusing the same local-first lookup rather
than launching or authorizing the application. Invalid scan content reports an
error without replacing the current search. Repeated scans reset the search
instance; mode changes preserve the query. Empty Favorites links to Discover.
The header's compact mode selector and Scan action share one row; its fixed
search field occupies the second row. Keyword search uses only desktop shortcuts
in Favorites and the fetched catalogue in Discover. The results component keeps
per-query display windows, and Favorites keyword search never starts discovery
reads. Clearing a Favorites search restores its shortcut grid. Favorites omits the recent
preview; the leading header action in both modes opens `/explore-recent`. Recent-only accounts
show the empty Favorites state while retaining that history entry point. History
uses the shared discovery row in a virtualized list, opening details on press. Discovery and history share pointer-anchored menus for
details, permissions, sharing and Favorite/Unfavorite; history always exposes
Remove, which clears recency without changing favorites. Detail header menus
expose favorite actions while keeping history removal in the history list. Runtime menu footers include a favorite toggle;
all menu favorite changes use the shared hook for persistence and bottom-toast feedback.
Discovery search recognizes bare naddr, `nostr:naddr`, naddr share-link URLs, and
HTTP(S) website addresses. It checks the fetched catalogue, its account-scoped
64-entry address cache, saved in-memory entries, and an exact asynchronous local
repository lookup before networking. Signed misses query only their hints; with
no hints they query the deduplicated union of NIP-65 write relays and that format's
dedicated sources, including nsites for explicit input. Manifests are matched and
signature-verified before display. Plain URLs become website entries without an
invented author or relay lookup. A 300ms debounce and abortable transport prevent
superseded lookups from publishing results. Details can resolve address-cache
entries independently of the curated browsing window.
Explicit application links retain their relay hints and author routing.

`explore_entries` caches verified manifests and visited URLs;
`explore_shortcuts` owns explicit order and retained sync references; `explore_history` keeps one latest visit
per address, bounded to 512 per account. This is not a chronological click log.
Favorites synchronize through the shared private-list/configuration infrastructure
using [encrypted app-curation snapshots](../protocols/application-favorites.md).
Both history and shortcuts refer to the cached identity, independently of signing
authority. Website addresses keep their path, query and fragment, whereas signing
rules bind only their host-verified scheme, host and effective port.

Napp support includes NIP-07 identity/signing and per-request NIP-04/NIP-44
cryptography, declared network access, origin storage, theme updates, link/close/log
helpers, all 42 reference `napp.utils` methods, synchronous Nostr helpers,
public-event reads and subscriptions, metadata/list/set lookups, user discovery,
signed-event publication, bounded synchronization, relay health, and the local
NIP-DB store. Clipboard writes and file saves require independent consent. Actions route to live handlers or verified
cached applications after user selection. Mobile keeps up to seven calling
containers mounted behind the active handler and returns to the caller when the
handler closes; desktop handlers use independent windows. Configuration and INC
use the pinned NAP shim and account-scoped host services. Desktop IPC brokers
messages across trusted hosts while application frames remain unprivileged.
The reference launcher's UI kit and private chat APIs are not provided.
See [napp bridge](../protocols/napp-bridge.md) for method and authorization details.
Unsupported required domains fail before execution; unknown methods return an
explicit error.

Electron bundles bridge code in its isolated preload and passes a small typed
bootstrap descriptor, keeping generated helpers out of command-line arguments.
The native public-resource adapter now supports allowlisted JSON Accept headers,
so installed mobile development clients need a native rebuild. Android Explore requires document-start script injection and
WebView multi-profile support. iOS 17 and later use named persistent account
profiles; earlier systems use ephemeral website storage. No package dependency
was added for this feature.

Browser permission requests automatically allow persistent storage and ordinary
clipboard writes. Recognized sensitive resources share signing's duration menu
(one visit, 10 minutes, one hour, 24 hours, or always), applying the selected
duration to allow and deny alike. Records are per account, current website origin
or signed application address, and resource in `browser_authorizations`; media
requests retain separate camera and microphone resources. Screen capture,
unknown permissions, window/external navigation, and downloads require fresh
review. Permission management edits and reset invalidate active document caches
across application windows; timed permission-check leases expire independently.
