# Napp bridge

PsstPsst implements the NAPP launcher interfaces for kind-35130 applications.
The reference is [NAPP](https://github.com/eskema/nostrapps/blob/main/NAPP.md).
The bridge is injected before application scripts and belongs to one main-frame
document. Navigation invalidates its requests, subscriptions and endpoint.
The interface inventory follows nostrapps commit
`cd4551778bf144f6977125d1ad4751ee8299be3f` and the public list/set projections in
nostr-gadgets commit `f658343c02e8f94fac9391c643953045fa77a501`.

## Feature detection

`nostrdb.supports()` returns `Promise<string[]>`. Its empty list means no optional
query extensions, including NIP-50 search. Search filters fail explicitly.
The [NIP-DB draft](https://github.com/nostr-protocol/nips/pull/2229) specifies
`count` as a required method, not an optional feature. Absence of a `count` feature
string does not disable it. PsstPsst retains `nostrdb.count` and does not invent
negative feature strings. Local store behavior is defined in
[local relay](local-relay.md).

## JavaScript interface coverage

All 42 methods in the reference `Utils` interface have bridge implementations:

| Group | `window.napp.utils` methods |
| --- | --- |
| Profiles and author discovery | `loadNostrUser`, `searchUserLocal`, `searchUser`, `findAuthors` |
| Relays and servers | `loadRelayList`, `loadRelayInfo`, `loadBlossomServers`, `loadFavoriteRelays`, `loadBlockedRelays`, `loadSearchRelays`, `loadDmRelays` |
| Public lists | `loadFollowsList`, `loadMuteList`, `loadBookmarks`, `loadPins`, `loadEmojis`, `loadWikiAuthors`, `loadWikiRelays`, `loadFavoriteFollowSets`, `loadFavoriteScrolls`, `loadProfileBadges`, `loadSimpleGroups`, `loadGitAuthors`, `loadGitRepositories`, `loadMediaFollows`, `loadFavoritePodcasts`, `loadAuthoredPodcasts` |
| Sets | `loadFollowSets`, `loadRelaySets`, `loadEmojiSets`, `fetchFavoriteRelaysWithSets`, `fetchEmojisWithSets`, `fetchFavoriteFollowSetsWithSets` |
| Events and subscriptions | `loadEvent`, `loadEvents`, `verifyEvent`, `subscribe`, `publish` |
| Application-owned keys | `generateKey`, `signWithKey` |
| Device export | `saveFile`, `copyText` |

Lists return `{event, items}` with typed public items: mute entities, emoji
objects, relay read/write flags, event/address pointers and group descriptors.
Sets return a map keyed by `d`, with pointer, event, items, title and optional
image/description. Emoji sets use kind `30030`. Encrypted list content stays
opaque. Readers collect concurrent metadata requests in an 8 ms window and group
them by actual destination relay and event kind. Several authors' follows become
one filter with a result limit covering those authors; different kinds retain
separate filters in the same REQ. NIP-65 discovery lookups also coalesce authors
and share in-flight work. Only authors routed to a relay enter its filters.
Readers retain bounded caches; public-store additions invalidate matching
projections. One failed destination does not discard another destination's valid
event or turn an unconfirmed empty read into a cached missing list.

Connections are reused within an execution and authorization context. Public,
authenticated and signer transports remain separate, and independent application
windows do not share sockets. Idle destinations can be evicted from the bounded
cache; completed reads do not consume a permanent historical relay allowance.

`napp.nip19` provides synchronous `decode`, `npubEncode`, `noteEncode`,
`neventEncode` and `naddrEncode`. `napp.fx` provides `isHex64`, `parseCoordinate`,
`formatCoordinate` and `satsFromBolt11`. These helpers and throwaway-key signing
run inside the application frame; generated secret keys never enter host RPC.

`loadEvent` accepts encoded references, URIs, hex IDs and decoded event/address
pointers, plus optional relay and author hints. `loadEvents` batches missing IDs
into queries. Publication returns `{published, failed, relays}`, with per-relay
outcomes, after the host's existing authorization checks.

`napp.sync(authors, kinds, options)` imports verified public events from selected
write relays, saving each received event before EOSE in both full and limited
syncs. Full ranges combine authors and kinds in one filter per relay and
missing-range group and prioritize groups covering more authors; limited calls
preserve per-author/kind limits.
All source relays for a limited author/kind share one admission budget; each
distinct incoming event reserves a slot before being queued for persistence.
Completed ranges and identical limited queries are
remembered for the current document. Full range requests subtract already-fetched
intervals; interrupted or saturated pages never become completed coverage.
Concurrent work for one author/kind is serialized. Syncs share at most 16 active
REQs per process. Author and kind counts, requested limits, total event counts
and page counts are not capped. Timestamp buckets too large for safe pagination
fail explicitly. Coverage is execution-local and is rebuilt
after navigation or restart.

`napp.outbox(filter, options)` requires authors without imposing an author-count
limit. It fetches all authors' relay lists before grouping requests by relay.
Missing write lists or lists exceeding eight destinations use default relays;
up to four candidates per author participate in greedy grouping. Groups with
more authors take priority. When there are more than ten candidates, a group
covering fewer than ten authors is omitted only if every author already has
two retained destinations. It returns `{close}` and shares `utils.subscribe`
callbacks: `liveEventCallback(event)` receives every deduplicated event as it
arrives, including historical events; `eoseCallback(relayUrl)` independently
reports each relay's EOSE without waiting for other relays. Failures and timeouts
do not generate synthetic EOSE notifications. There is no initial
event batch or `eoseEventsCallback`. Terminal relay reasons use `closedCallback`.
Both APIs save accepted public events before delivering them, allowing
`nostrdb.query/subscribe` to observe them. Private-message event kinds never enter
the device-wide public cache. Closing the document cancels subscriptions and
queued deliveries.

Remote filters preserve extension fields, strings and requested limits for the
relay to interpret. Local queries cap limits at 1,000; unsupported `search`
filters match nothing, including in local subscriptions.

Data calls have no host-imposed author, relay, identifier, set, subscription or
pending-RPC count limits. Remote query results are not truncated by event count.
Batching, concurrency scheduling and idle/cache eviction are internal mechanisms;
they must not reject valid protocol requests or silently discard requested data.
Protocol-defined bounds and explicit local query limits still apply.

`napp.relays.health(urls)` returns NIP-66 monitor projections for up to 200 relays.
Recent check-ins within two hours mean online; older check-ins within a week mean
offline; absent check-ins mean unknown. Results include check time, median RTT,
advertised NIPs and requirements. `loadRelayInfo` requests NIP-11 JSON through the
bounded public HTTPS adapter. Public identifier resolution uses the same adapter.

Local author search seeds from up to 1,000 cached public profiles, then updates
incrementally as public profiles are loaded or stored. Its index retains at most
2,000 profiles and 4 MiB. Remote author search uses public NIP-50 relay queries;
this does not enable the independent `nostrdb` search extension. Author picking
ranks public follows first, excludes public mutes and optionally verifies public
identifiers. Local candidates are filtered and ranked before applying the result
limit. It never substitutes private PsstPsst contacts.

`saveFile` accepts Blob and buffer inputs, obtains file-specific consent, and
streams credited chunks into a host-owned temporary file before the system
destination picker. The application supplies a sanitized filename, never a path.
There are at most two transfers, 64 MiB per file, with 48 KiB chunks and a
two-minute staging deadline. Document teardown cleans staged files. `copyText`
writes text without a host confirmation and cannot read the clipboard. Signing
permissions do not grant file saving or clipboard reading.
The standard `navigator.clipboard.writeText` method uses the same host
transport across Electron, Android and iOS, including ordinary websites and nsites.
It returns a promise that settles after the native clipboard write, not after enqueueing.

Private PsstPsst chat access remains outside this bridge.

## UI kit and local installation

The `ui` and `dev` contracts follow nostrapps commit
`08a7f6f3335da56d86acc715567812ca11b7c873`.
Granted `ui` access injects the pinned launcher kit as `napp.ui` before app
scripts, with its stylesheet before application styles. The full pinned helper
surface is retained. `fonts()` uses system-font fallbacks without remote loading.
Author helpers use public-data APIs and existing action authorization.

Granted `dev` access exposes `napp.dev.installLocal(files)` for HTML napps.
Files accept Blob, ArrayBuffer, typed-array or string data and optional MIME
types. The result is `{ nappId: "local~<id>" }`, or `null` on cancelled review.
Every installation/replacement reviews the target's own access; another
installer's target also receives a saved-data warning. New code does not inherit
the installer's grants or a replaced app's signer/browser authorizations.
WASM-only and alternate napplet installation formats fail explicitly.

Local application identities are account-owned and unsigned, independently of
signed listings. Replacements atomically commit a complete hashed file map and
invalidate old documents before reload. Installation does not automatically sign
or publish anything. See [implementation and limits](../implementation/napp-ui-dev.md).

## Actions

`napp.registerAction(pattern, handler?)` registers a document-scoped handler;
omitting the callback permits a popstate-only handler. `napp.action(name, payload,
options?)` selects a live handler belonging to an application in My apps or a verified
My apps entry declaring the action. Both paths use the caller's account.
An explicit call to the caller's exact live document instance dispatches directly
without My apps membership or a chooser, after checking its registered action and
mode. Other instances, including another window of the same app, require My apps
membership. Removing an app excludes its running handlers from subsequent
cross-application selection and delivery.
The chooser names the caller and content purpose and asks which app to
open it with. Candidate rows reuse discovery's icons, names, publishers and format
labels. An empty chooser offers capability-filtered Discover; an unavailable
explicit instance offers no discovery handoff. Failure diagnostics include the
action name, instance identifiers and routing rejection reason, never payloads. Closing the empty chooser settles
as `permission-denied`, like cancelling a populated chooser. The sheet's Close action dismisses only this handoff. Android launches
selected applications in independent document tasks and focuses an existing task
when delivering an action to its live handler. Options may identify one live
`instance` or request an `auxiliary` application. Exact patterns match; `view`
also matches `view:<kind>`. Specific view actions require a verified event of
that kind. Generic view actions retain an unresolved reference when resolution
fails. `napp.instance` identifies the container synchronously; awaiting
`napp.ready` ensures its host endpoint has connected.

Delivery updates history and dispatches popstate with `state.action`.
Object history states carry `__action_popstate_idx`; during popstate,
`napp.__popstate_last_idx` exposes the previous index. Callback return values and
errors settle the caller's promise. A popstate-only handler returns null after
delivery. Closing either endpoint cancels outstanding calls. Handler startup has
a 25-second deadline; a delivered action has a two-minute deadline.

## Encryption

Napps receive `nostr.nip04.encrypt/decrypt` and `nostr.nip44.encrypt/decrypt`.
They use the account's identity signer, including remote NIP-46 signers. They
never use the separate messaging key or read private conversation tables.
Public-key access and crypto invocations use the shared signer authorization
service with Once, timed and Always decisions. Rules bind the account, current
verified source and method; crypto rules distinguish algorithms but apply across peers.
Decryption consent explains that readable content reaches the application.
Signing rules do not grant encryption authority. Invalid peers and oversized
inputs fail before consent; unavailable signer operations fail explicitly.
Results are discarded after navigation, revocation, account change or timeout.

## Configuration and communication

Declared `config` and `inc` requirements enable the pinned NAP shim under
`window.napplet`, using the same interfaces as the reference launcher.
Configuration supports `registerSchema`, `get`, `subscribe`, `openSettings`,
`onSchemaError` and the shim's schema property. Host forms use the restricted
[configuration schema](../../src/services/napplet/config.ts). Schemas and values
are scoped to account and signed application identity. Schema upgrades preserve
valid values and apply defaults. Saves notify subscribed windows of that source.
Applications cannot save values through the bridge; only host UI can do so.

INC supports topics and peer channels through the pinned shim. The host assigns
sender identities, isolates accounts and requires declared access. Opening a
channel additionally requires consent naming the target application. Endpoint
closure removes subscriptions and closes its channels. Topic, channel, endpoint,
message size and outstanding-request limits bound memory and delivery work.
