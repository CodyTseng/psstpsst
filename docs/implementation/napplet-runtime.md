# Embedded application runtime

This note covers host lifecycle, storage compatibility, and platform caveats for
napplets and Explore. Use the [application contracts](../protocols/README.md#embedded-applications)
for observable bridge and authorization behaviour.

## Runtime lifetime

Navigation first commits an account-bound container. That container owns
verification, preparation, recovery, and cancellation. Late work must check
both the account and run before committing. A departing inline route can release
only the run it owns. Independent hosts have their own runtime and document
but share account services. Android uses separate trusted React surfaces in
non-exported tasks, with only the foreground task presenting shared approvals.
Task intents carry opaque in-memory IDs and cannot restore authority after
process death.

A trusted wrapper signals readiness after the app document loads and crosses a
paint boundary. Mobile can keep the surface hidden until that signal.
Electron must first give its WebContentsView visible bounds because a hidden
view suppresses frame callbacks. Input stays blocked until trusted readiness.
When renderer overlays cover an Electron WebContentsView, paint a bounded
in-memory preview before removing the live view and restore the view before
clearing the preview. Native sheets already composite above mobile WebViews.

Navigation blocks pending document operations until a trusted commit. If a
canceled load leaves the old DOM in place, that DOM receives a fresh session
with fresh appearance and navigation snapshots. Earlier requests remain
canceled. Host dialogs and file workflows retain the initiating document scope
through their callbacks.

Signed mutable releases get one deferred refresh after launch. Running
instances pin the verified release. Foreground, unobscured instances may offer
a restart for a newer release. Acceptance waits for old runtime teardown before
starting the replacement.

## Isolation and resources

NAP documents run as opaque-origin iframe content inside a trusted wrapper.
Native message handlers trust the wrapper's main frame, and the wrapper checks
the sending frame before forwarding. Electron uses an independent,
nonpersistent WebContentsView with the minimal application preload.
The napplet CSP blocks direct network access, workers, nested frames, form
submission, and executable remote resources. WASM byte compilation remains
available. The wrapper rasterizes SVG into bounded PNGs before exposing it.

Public resource reads are mediated and bounded. Validate DNS on the actual
connection path, keep TLS tied to the original hostname, and reject redirects.
The public DNS fallback handles Fake-IP VPN configurations while rejecting
private destinations. Bulk requests preserve successful siblings within the
aggregate budget. Resource decoding and artifact verification yield or run
off the UI thread.

Napps and ordinary websites use their own host paths. Android Explore depends on
document-start script injection and WebView profile support. iOS 17 and later
use named persistent website profiles for accounts. Earlier versions use
ephemeral website storage. Host permission edits invalidate live document
decisions across windows.

## Storage compatibility

Application data, configuration, and grants bind to the owning account and
stable application identity across releases. Transient instance data stays
in memory. Namespace migration merges known prior identities, retains
unresolved values in a read-only backup, and rebuilds quota counters. Schema
changes retain compatible values and fill defaults for new fields.

Artifact paths preserve portable relay-free addresses, including legacy files
and hash fallbacks for long names. See
[the artifact service](../../src/services/napplet/artifacts.ts).
Reuse legacy files only after verifying their hashes. Version metadata is a
rebuildable cache index. Commit completion only after all required files are
verified. Atomic updates must preserve other versions and concurrent icon
changes. Store credentials and application-private data separately.

Website artwork is cached by origin while visits preserve the full shortcut
URL. Stage replacement artwork before publishing metadata and remove the old
file only after the new record is committed. Keep usable local artwork on a
failed refresh. Bound refresh and decoding work.

## Explore integration

- Share verified metadata and relay transport across address lookup,
  discovery, and publisher browsing. Dedicated catalogue sources and
  exact-address resolution have different scopes. Exact lookups support
  immutable snapshots even where browsing excludes them. For exact event-ID
  references, the verified event determines its kind and author. Optional
  pointer hints do not constrain the lookup or turn it into a coordinate.
- Catalogue pagination retains independent cursors and buffers for each
  relay/query. Merge verified batches incrementally. Search the loaded
  catalogue without advancing its cursors. An exhausted same-second query
  boundary can stop pagination because fixed-size NIP-01 filters cannot skip
  already returned IDs. Full discovery and capability discovery retain
  independent pagination even when they share exact-address metadata.
- Installed apps, saved apps, visits, and live endpoints have independent
  lifetimes. Eligibility for an intent or live handoff is rechecked at
  dispatch. An unavailable remembered handler can return to selection once.
  If an invocation may have run, report the failure without dispatching it
  again. Account and endpoint teardown cancel outstanding requests.
- My apps can show its durable local snapshot before manifest hydration.
  Scrolling pages metadata without waiting for a signer. Changes to one
  application's metadata refresh that item while preserving order and cursor.
- Upload jobs stage approved bytes and bind the destination, hash, and size to
  the reviewed operation. Cancel staged work and suppress replies on document
  teardown or access revocation.

See [Explore services](../../src/services/explore/) and
[napplet services](../../src/services/napplet/).

## Verification

Run the focused runtime checks for the affected boundary.

```sh
npm run test:napplet-browser
npm run test:napplet-electron
npm run test:napplet-gallery
npm run test:napplet-signing
npm run test:napplet-database
```

The browser suite exercises the shipped shim and isolation. It uses Chrome on
macOS or Playwright Chromium elsewhere. Set `NAPPLET_CHROME` to select a browser.
Native runtime changes need a native development build. On a connected Android
device, verify the shipped WebView wrapper with the integration suite.

```sh
cd android
./gradlew :expo-napplet:connectedDebugAndroidTest -PreactNativeArchitectures=arm64-v8a
```
