# Napplet runtime

PsstPsst hosts HTML napplets, including embedded single-threaded WebAssembly,
under the currently selected account. There is no guest account or DM capability.
The third primary tab contains Recent and Discovery. Each account owns its recent
apps, pins, installations, settings, permissions and default intent handlers.

## Protocol baseline

- NIP-5D PR 2303, `020cb8b33a9e4c6b8ca4b2f9d0ed0a67843b68f7`.
- `@napplet/shim` 0.32.0, with core/nap 0.34.0 locked by package-lock.json.
- NAP-OUTBOX PR 32, `8865f73d52a4864afee145f28d26520476273927`.
- NAP-STORAGE PR 3, `4f4cf0ca7ecbd24c284a5d63bcd85e3de6af37ca`.
- NAP registry: <https://github.com/napplet/naps>.

These proposals are drafts. Domain availability is not a declaration of complete
conformance to every evolving proposal. The host implements shell, theme,
storage, resource, link, identity, relay, outbox, intent, inc and config. Unknown
messages and application-supplied reply envelopes have no authority.

## Ownership and lifecycle

`nappletService` owns the vanilla store, catalog connection, permission prompts
and single foreground execution session. React bindings live in `src/stores/`.
Account lifecycle invalidates the session before changing identities. Application
lock and route blur stop execution. Selecting a different account resets the
mini-app page to Recent. Stopped sessions abort requests and discard
late results; their connections, signer, INC endpoint and native container close.

The manifest identity includes publisher and kind. Named manifests additionally
include the opaque `d`; snapshots use their signed event ID. Permissions and shared
KV namespaces include account, manifest identity and artifact hash. Instance KV is
memory-only. A new artifact receives a separate namespace; updates do not silently
copy data or grants. An explicit, atomic migration can copy shared application KV
into an empty new-version namespace; it never copies grants or host settings. Previous code and data remain available for rollback.

Recent removal only clears recency and pin state. Opening the app again restores
it. Shared immutable artifact files are hash-verified before execution and kept
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
Android retries non-public system DNS answers through
Cloudflare or Google DNS over HTTPS using pinned bootstrap IPs. Only independently
resolved public addresses are admitted; TLS still verifies the original hostname.
This supports Fake-IP VPN DNS without allowing access to private endpoints. The
fallback cache is bounded and expires within the DNS TTL or 60 seconds.
Requests, byte sizes and concurrency are bounded. HTTPS, Blossom and data URLs are implemented;
other schemes return an unsupported-scheme error. Bulk requests accept the pinned
SDK request objects and legacy URL arrays, preserve successful siblings, and
bound aggregate reply size and total request time.

## Runtime controls

The runtime header exposes More and Close. More opens app identity and publisher
information, with Share, Settings and Reload actions. Sharing hands a stable Nostr
app address to an embedded instance of the existing recipient picker after the
host sheet closes. The app container stays mounted and hidden; completion or
cancellation returns to that container, even for multiple recipients. Background
approvals wait without a review timer until sharing ends. App
references in messages open the app detail flow. Settings lists required access,
editable optional domains, and installed-artifact signing rules. Optional access
changes reload the container; individual signing rules can be revoked live.
Management, configuration and signing prompts share one host sheet, with consent
taking priority. The native child surface stays hidden through its exit animation.

## Nostr operations

Runtime relay clients reuse ManagedRelayPool behavior, with independent public,
authenticated and NIP-46 transport pools. They never borrow the chat pool's AUTH
state. Reads are bounded and signed events are verified. OUTBOX resolves author
write relays; publication combines own write relays, explicitly requested relays
and required recipient read relays. Missing required recipient routing fails.
Live OUTBOX subscriptions refresh routing and retain bounded deduplication state.

Signing permission is separate from NAP domain access. Initial access grants the
required domains; optional domains start disabled and can be selected individually.
The host queues at most 16 approvals, shows one at a time, rejects stale approval
IDs and cancels requests on session termination. Each approval receives 25 seconds
when it becomes visible; queued requests have no running review timer. Explicitly
rejecting the whole queue pauses prompts for one minute or until the execution
session ends. Routing and post-approval signing each have a 25-second budget; late
remote signatures are discarded without publication. The injected pinned OUTBOX
shim extends only publication waits to 460 seconds to cover the bounded queue
and these execution budgets.

Requests default to one-time approval. The user chooses one request, a timed
decision (10 minutes, one hour or 24 hours), or an indefinite decision for this
version, then selects Allow or Reject. Custom event kinds use a generic event-type
description; the host never invents an application-specific purpose. Legacy
session grants remain valid only within their execution session. Rules match the
operation, kind, addressable record identifier and encrypted
recipient, within the existing account/app/artifact namespace. A change to any
constraint requires another approval. Publication grants do not bind relays. AUTH
grants bind the server. Version 3 storage invalidates older relay-bound publish
grants instead of migrating them into broader permissions. Timed allow and deny rules survive reopening
but are checked for expiry on every use and removed from the management view when
they expire. Rules are limited to 64 and 256 KiB per
execution session. Persistent writes are serialized before grants become active.
Per-rule revocation invalidates the active cache and any in-flight authorization
or unpublished signature before serializing persistent removal. Resetting all
grants still stops the session. App updates and storage migrations never transfer signing grants.
The app details show the installed version's rules and the latest 32 permission
decisions, storing only action type, kind, decision and time. This history does
not store event bodies and does not claim successful signing or publication.

Authorized publication signs once and reports per-relay outcomes.
Account configuration, key announcements, signer protocol traffic and
private-message envelopes are protected from generic publication. Replaceable
account settings, follow sets and reserved PsstPsst identifiers are blocked.
Consent expires 25 seconds after presentation; submitted timestamps are
retained when valid, with future timestamps limited to one day. NIP-44
publishEncrypted is available; NIP-04 is not. This API does not expose messaging
keys, decrypted chat histories, wallets or arbitrary signing primitives.

IDENTITY reads public Nostr projections. It never substitutes private PsstPsst
contacts or blocks. Unsupported identity projections return an explicit error.

## Composition and settings

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

The host bounds installation libraries to 512 entries, loaded discovery to 500,
filters to eight with at most 200 events per filter, routed authors to 16, and a
runtime's destination set to 24. Query and live-event buffers are byte-bounded;
live delivery yields between batches. A process-level lifecycle observer retains
only live relay pools. Verified manifest metadata and public icons are cached so
pinning an app does not repeat settled cryptographic work.

Additional checks:

```sh
npm run test:napplet-electron
npm run test:napplet-gallery
npm run test:napplet-signing
npm run test:napplet-database
```
