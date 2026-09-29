# Nearby File Transfer Implementation

The interoperable offer and record exchange are specified in
[`../protocols/nearby-file-transfer.md`](../protocols/nearby-file-transfer.md).

Before a file rumor enters the message outbox, PsstPsst persists the managed
plaintext, the encrypted Blossom spool, the upload targets and retry state, and
the complete rumor. Uploads retry independently. The spool may be removed after
one target confirms the exact ciphertext; reconstruction is allowed only from
verified plaintext with the original key and nonce and must reproduce `x`.

When Internet access appears reachable, the sender gives the upload a bounded
foreground opportunity before sending the rumor. A timeout, offline hint, or
failed upload never blocks Nearby delivery; the durable upload job continues.
Receivers do not permanently negative-cache a temporary `404` from a planned
server.

## Source selection and scheduling

Remote retrieval is attempted before BLE when network policy permits. A remote
miss or failure may fall back to direct transfer. Plaintext and ciphertext
partials have independent offsets, and only one source is active at a time.
Explicit cancellation stops the logical fetch rather than switching sources.

Remote retrieval requests `GET /<x>.bin` from `xs` servers in manifest order.
The client hashes the complete ciphertext, decrypts it with the rumor key and
nonce, and verifies `plain-size` and `ox` before finalization. A temporary `404`
is retryable. Direct progress is plaintext addressed by `ox`; remote progress is
ciphertext addressed by `x`, so their offsets are never combined.

Blossom upload authorization uses the proximity identity that authored the
Nearby rumor rather than the owning Nostr account identity.

The direct-transfer scheduler limits active transfers, prioritizes chat and
control records, reads at most one negotiated chunk per operation, and preserves
Noise nonce order through the shared outbound FIFO. A lack of durable progress
is retryable; disconnect and session rotation retain the resumable partial.

One BLE file transfer per peer and a bounded global number are active. A sender
reads at most one negotiated chunk into memory per operation. The receiver sends
progress after at most the negotiated window or one second. A transfer with no
durable progress for 15 seconds is cancelled as retryable. Partials with no
progress for seven days are removed when the Nearby file service next starts.

## Authorization

The sender serves only on a ready, unblocked Noise session when all of the
following hold:

1. The authenticated peer is the rumor's sole recipient.
2. The message exists under the requested rumor ID in that peer's conversation.
3. The rumor is kind `15`, was authored by the active proximity identity, and
   carries the requested `ox`.
4. Conversation ownership still matches the active proximity identity and the
   conversation remains writable.
5. A managed plaintext file exists with the declared `plain-size`.

The lookup uses the message primary key and peer; it never scans by content
hash. Deleting the message or conversation removes the grant. Rate limits and
transfer-capacity checks happen before file I/O. Every denial that could reveal
existence is reported as `NOT_AVAILABLE`.

## Receiver finalization

Receiver state records the account, peer, rumor, expected hash and size,
contiguous offset, partial file, and last progress. Finalization checks size and
SHA-256 away from UI rendering, derives a safe MIME type, atomically inserts the
managed file, and records the manifest mapping. Unverified partial files are
never opened by the UI and are removed after cancellation, integrity failure,
or expiry.

The finalization order is:

1. Flush and close the partial file.
2. Verify `plain-size` and `ox`.
3. Derive a safe MIME type from bytes, falling back to the declaration.
4. Atomically move the file into the content-addressed managed store.
5. Persist the BUD-10 URI mapping and stored-file record.
6. Send `FILE_COMPLETE(STORED)`.

A missing or evicted partial resets resumption to offset zero. Disk reservation
happens before acceptance, and integrity failure deletes the partial.

## Forwarding and verification

Forwarding creates a new rumor and recipient grant. Relay forwarding waits for
a confirmed Blossom copy. If the encrypted spool is absent but verified
plaintext exists, the original ciphertext may be reconstructed and checked. If
neither verified representation is available, forwarding fails before
publication.

Tests cover manifest parsing; both hashes and sizes; proximity-signed upload
authorization; indistinguishable denials; chunk, window, and state bounds;
restart resumption; final verification and atomic insertion; storage failure;
control-message priority; queued upload; temporary `404`; source fallback;
separate partial offsets; cancellation; and forwarding before and after upload.
