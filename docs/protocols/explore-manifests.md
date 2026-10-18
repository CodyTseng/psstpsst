# Explore app and site manifests

Explore reads named nsites (`35128`), root nsites (`15128`), and napps (`35130`).
Napps follow the manifest identity and file layout described by
[NAPP](https://github.com/eskema/nostrapps/blob/main/NAPP.md) and
[NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md).
Classification follows the signed event kind, never capability tags. Napplet
formats remain defined in [napplet manifests](napplet-manifests.md).

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
of website navigation: remote pages keep their actual HTTP(S) origin.

Napplets, napps, nsites, and websites always receive the NIP-07 public-key and event-signing
methods, regardless of an `identity` requirement declaration. Injection does not
grant account access or signing authority. Signing returns
a signed event; it does not publish it. An ungranted account identity request
requires consent, and event signing uses the shared account/source/kind/d-tag
rules. Optional NIP-07 encryption methods are not advertised.

Napp public-event queries and public metadata reads do not require a declared
relay or identity capability. Account disclosure, signing, and publication retain
their separate authorization boundaries.
