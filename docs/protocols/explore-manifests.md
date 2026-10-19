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
a signed event; it does not publish it. An ungranted account identity request
requires consent, and event signing uses the shared account/source/kind/d-tag
rules. Napps additionally receive the NIP-04 and NIP-44 encryption methods;
each operation requires separate, one-request consent. Nsites and websites do not
receive these optional methods.

Napp public-event queries and public metadata reads do not require a declared
relay or identity capability. Account disclosure, signing, and publication retain
their separate authorization boundaries.
