# Explore app and site manifests

Explore reads named nsites (`35128`), root nsites (`15128`), and napps (`35130`).
Napps follow the manifest identity and file layout described by
[NAPP](https://github.com/eskema/nostrapps/blob/main/NAPP.md) and
[NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md).
Classification follows the signed event kind, never capability tags. Napplet
formats remain defined in [napplet manifests](napplet-manifests.md).

Napps are ordinary web applications with direct network access. Their effective
host launch requirements include `network` even when the signed `requires` tags
omit it. This derived requirement is shown in access review and checked against
persisted grants; older grants need consent before gaining it. The original
signed manifest is never rewritten. Sealed napplets retain their mediated-only
resource policy.

Named manifests require one nonempty `d` tag; root manifests have none. Each
`path` maps an absolute, unambiguous path to a SHA-256 blob. Paths cannot escape
the application origin. `/index.html` is required, with at most 512 distinct files
and 32 MiB total decoded bytes. If an aggregate hash is present, it must match the
sorted `<hash> <path>\n` lines. File responses use host-selected MIME types.
Every downloaded blob is verified before it reaches the container. Static containers
do not register service workers; updates cannot retain a worker serving an old bundle.

Servers come from manifest `server` tags, falling back to the author's verified
kind-10063 media-server list when hints are absent or cannot supply a file. The
lookup is lazy and shared by the bundle's bounded download workers. Public downloads
follow at most five redirects under one deadline; each target must pass URL, public
DNS and TLS checks before connecting. Requests use the existing public-resource transport and its DNS,
TLS, size, cancellation and hash checks. Static bundle resolution is independent
of website navigation: remote pages keep their actual HTTP(S) origin. Electron
uses separate account-scoped sessions for remote pages and verified bundles;
ordinary website navigation uses Chromium's native loader without the bundle
HTTPS handler. Clearing account page data clears both sessions.

Document-start bridge scripts are generated browser-source strings at build time,
never recovered from host function source at runtime (Hermes may retain only bytecode).
Android main-frame load failures are reported to the runtime so the user can retry
instead of waiting indefinitely for the bridge's first-paint handshake.

Napplets, napps, nsites, and websites always receive the NIP-07 public-key and event-signing
methods, regardless of an `identity` requirement declaration. Injection does not
grant account access or signing authority. Signing returns
a signed event; it does not publish it. Public-key access uses the shared signer
authorization service on every request, independently of launch permissions.
Event signing uses account/source/kind/d-tag rules. All formats also receive
NIP-04 and NIP-44 encryption/decryption methods when supported by the account's
signer. These decisions support Once, timed and Always choices. Public-key,
encryption and decryption grants remain separate; crypto grants also bind the
algorithm and peer. Website grants bind the current main-frame origin rather
than the original launch address. Revocation invalidates cached decisions and
prevents in-flight public keys or crypto results from being returned.

All formats bridge `navigator.clipboard.writeText` to the system clipboard port.
The current verified document owns the request. Text writes require no host
confirmation, and the browser promise resolves only after the OS write succeeds.
This path does not rely on embedded-browser clipboard permissions or grant reads.

## Browser compatibility

Application opens reuse the existing account/source instance on Electron and
Android. Nostr relay hints do not change the instance identity; website shortcuts
retain their launch URL identity while navigation preserves the running page.
Window/task close events update the host's running-icon indicator.

`window.open` and links targeting a new window request host approval, then launch
or focus an application window/task. This launcher handoff does not expose a
cross-renderer JavaScript `WindowProxy` or `opener` object. External protocols also
require approval before OS dispatch. Website information sheets can open the
current page in the system's default browser.

Electron mediates native browser permission requests. Android handles media,
location and fullscreen callbacks, OS permission prompts, file selection and
JavaScript dialogs through its WebChromeClient. iOS implements media review,
native JavaScript dialogs and download delegates; WebKit manages its system
location prompt. All native replies are tied to the current document, and
cross-origin subframes receive no account authority.

HTTP downloads use native browser/session cookies. Consent precedes the system
destination picker or export picker. Android does not forward a site's cookies
across origin-changing redirects. Blob/data exports use a single-use consent
ticket and credited 48 KiB chunks with a 64 MiB bound and two-minute staging
deadline. Temporary files are removed after completion/cancellation.

Text/image clipboard writes do not prompt. `ClipboardItem` image writes stage a
native image before copying; text/html writes preserve a plain-text fallback.
Legacy `execCommand('copy')` keeps its synchronous command-acceptance contract
and forwards selected/custom text to the same clipboard port. Clipboard reads
prompt separately. Known permission queries return browser-compatible status
objects; notification status follows the document's grant. Mobile website
notifications use OS permission and a bounded separate notification namespace.

Napp public-event queries and public metadata reads do not require a declared
relay or identity capability. Account disclosure, signing, and publication retain
their separate authorization boundaries.
