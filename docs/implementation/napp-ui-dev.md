# Napp UI and local installation

PsstPsst implements the `ui` and `dev` requirements from
[nostrapps NAPP.md](https://github.com/eskema/nostrapps/blob/08a7f6f3335da56d86acc715567812ca11b7c873/NAPP.md),
pinned to `08a7f6f3335da56d86acc715567812ca11b7c873`.
These are NAPP launcher interfaces, distinct from NAP domains.

## UI kit

The unmodified upstream UI helpers and stylesheet live in
`src/lib/napp/vendor/`, with their Unlicense and provenance. The existing helper
generator produces icon-mask CSS and a separate browser bundle. Only a napp with
`ui` receives that bundle, after its bridge and before application scripts.
Styles precede application styles; the kit never styles trusted host chrome.

All pinned helper exports, properties and element methods are retained.
Author lookup and profile actions use existing public-data/action APIs; private
contacts, conversation data and decrypted lists are not exposed. Theme surface
and text variables follow the host, including live changes. `fonts()` is an
idempotent promise using the documented system-font fallback; no remote kit or
font download is required. Run `npm run napplet:prelude` after adapter changes.

## Local installer

`napp.dev.installLocal(files)` accepts relative/root-relative paths and Blob,
ArrayBuffer, typed-array or string data, plus optional MIME types. Its browser
adapter sends a bounded descriptor followed by credited 48 KiB chunks; typed
array offsets and UTF-8 strings are preserved. It resolves to `{ nappId }` on
commit or `null` when the installation review is cancelled.

The host requires an authenticated napp document, a declared `dev` requirement
and its persisted grant. It checks that grant at staging and again after review.
Forged RPCs do not acquire authority from the presence of a JavaScript namespace.
Each document has at most one active transfer. Limits are 5,000 files, 32 MiB
combined bytes, 64 KiB metadata and a two-minute staging/review lifetime, with an
additional free-disk reserve. Unsupported inputs fail explicitly.

`metadata.json` and `/index.html` are required. This implementation supports
HTML napps and their static assets. WASM-only and alternate single-file napplet
installation modes fail with `unsupported-local-format`; they are not advertised
as working installation backends. Requested unsupported domains also fail.
Automatic publication is not part of the installer.

Paths are canonical application-relative names, never filesystem destinations.
Traversal, encoded/ambiguous names, drive/UNC forms, control characters, duplicate
canonical names and reserved host policy paths are rejected. Files land in an
account-owned staging directory under generated names. The host hashes every
file and stores committed bytes under their hash, outside database records.
Serving verifies hashes again; image previews also classify the actual bytes.

## Identity, review and replacement

Local apps use `local~<metadata.id>`, a separate identity from signed Nostr
applications and website origins. The local application table binds its current
version and installer to its account. It contains no fabricated signed event or
publisher. UI identifies local apps as unsigned. Window hosts resolve local IDs
from the owning account's database instead of trusting launch-supplied metadata.

Every install or replacement presents the target, its required access and the
requesting app. Replacing another installer's app adds an explicit warning about
access to saved app data. Target capability grants contain only the reviewed
target requirements; installer grants are never copied. Replacements clear prior
signer and browser authorizations, so new code needs fresh sensitive-operation
review. Neither interface adds a key-export, credential-read or payment operation.

Installation moves complete, validated bytes to an immutable version directory,
then compares the previously reviewed version inside an asynchronous database
transaction that also clears old signer/browser decisions and saves the target
grants. Document-owned authorization writes require their pinned local version
to remain installed; an old document in another host cannot recreate grants
after the transition. Concurrent stale replacements fail without revocation. Cancellation before commit
keeps the old version runnable; cleanup does not delete files while a commit is
in flight. Platform/filesystem errors are reduced to safe installer error codes.

Active local documents receive same-process invalidation after a successful
commit and watch account-owned version changes across hosts. They lose their old
RPC authority before a replacement loads. Existing windows/tasks reload; first
installs open through the platform's normal application launch flow. Self-update
never waits for its own new document or delivers an old result into it. A
committed installation remains installed if its caller closes or launch fails.

## Persistence and cleanup

Each local app has an independent account/app browser storage profile. Desktop
membership and ordering stay device-local and are excluded from synchronized
signed favorites. Local apps can be reopened from history or their local ID,
added to the desktop, managed and uninstalled. They are not shareable Nostr
addresses and do not acquire public comments. List queries omit potentially
large file maps; launching resolves the current full account-owned version.

Uninstall resets permissions, erases its browser profile, then removes metadata,
app data and all managed versions. Account removal clears all its local profiles
and files. Aborted transfers clean staging immediately; subsequent installations
also recover abandoned staging and old versions older than one day. The current
version is never collected. No app byte bodies or underlying wallet/filesystem
error payloads are written to installer logs.

## Validation

Focused tests cover hostile paths, canonical duplicates, absent/revoked grants,
chunk order/size, cancellation during review, binary input forms, atomic version
conflicts, account isolation, foreign-key cleanup and document invalidation.
Browser tests execute the shipped generated kit and bridge, checking complete
export presence, callbacks, style precedence, theme updates, text safety,
font idempotency, binary offsets and absence of remote kit requests.

Run `npm run test:napp-ui-dev`, affected Jest suites, TypeScript and ESLint.
The existing Electron bridge/window integration suites cover document isolation.
The Android module must be rebuilt for the indexed asset lookup and profile
cleanup changes. Real iOS/Android installation and replacement interactions still
need device acceptance; browser tests and native compilation do not certify them.
