# Nearby File Transfer Protocol

## Status and scope

This document specifies the direct-file extension implemented by PsstPsst
Nearby Messaging version `1`. Peers negotiate it independently with the
`FILE_TRANSFER` capability; a peer without that capability keeps kind-15
messages network-only.

The extension transfers file plaintext through an authenticated Noise session
while retaining a standard encrypted Blossom blob for future remote retrieval
and forwarding. Bluetooth Low Energy (BLE) is the only direct byte transport in
scope. LAN upgrades, generic URL snapshots, emoji assets, directories, and
multi-peer broadcast are out of scope.

The base identity, access, record, ordering, retry, and BLE-fragmentation rules
in [`nearby-messaging.md`](./nearby-messaging.md) remain authoritative.

## Goals

- Send files between accepted Nearby peers without Internet access.
- Keep the kind-15 message remotely usable after its ciphertext reaches a
  Blossom server.
- Resume a partial transfer after disconnect, process restart, or a fresh Noise
  session.
- Authorize plaintext access by the message and authenticated peer, never by a
  bare content hash.
- Bound memory use and keep chat, acknowledgement, liveness, and close records
  responsive during a transfer.
- Reuse the existing plaintext content-addressed attachment store and kind-15
  rendering/indexing pipeline.

## File identities and representations

One file has two content identities:

| Name | Definition | Purpose |
| --- | --- | --- |
| `ox` | SHA-256 of plaintext bytes | Nearby direct transfer, final verification, and local deduplication |
| `x` | SHA-256 of `AES-256-GCM(plaintext)` encoded as `ciphertext || tag` | Blossom storage and remote retrieval |

The AES key is 32 bytes, the nonce is 12 bytes, and the tag is 16 bytes. A file
is encrypted once before its kind-15 rumor is authored. The exact ciphertext is
kept in a durable outbound blob spool until at least one planned Blossom upload
succeeds. Reconstructing a missing spool is permitted only by first verifying
the plaintext against `ox`, reusing the original key and nonce for that same
plaintext, and verifying the result against `x`.

Direct Nearby transfer sends plaintext chunks inside Noise secure records. BLE
itself is not a confidentiality boundary.

## Kind-15 manifest

The immutable kind-15 rumor is the file offer and the durable authorization
source. Its `content` is a
[BUD-10 URI](https://github.com/hzrd149/blossom/blob/master/buds/10.md):

```text
blossom:<x>.bin?xs=<server-1>&xs=<server-2>...
```

Rules:

- The URI hash is lowercase hexadecimal and exactly equals the `x` tag.
- The extension is `.bin` because the remotely stored blob is opaque
  ciphertext.
- Each `xs` is a normalized Blossom server scheduled as an upload target before
  the rumor is sent. Repeated `xs` values preserve configured preference order.
- A locally authored URI contains no `as` parameter. Proximity identities do
  not publish a BUD-03 server list.
- A locally authored URI contains no `sz` parameter. Authenticated rumor tags
  carry both sizes.
- Receivers remain interoperable with valid BUD-10 `as` and `sz` parameters
  authored elsewhere. `as` is only a discovery hint; `sz`, when present, must
  equal the authenticated `size` tag. Unknown parameters are ignored.
- A kind-15 message with an HTTP(S) URL or without a valid `blossom:` manifest
  remains a network-only attachment and does not authorize direct transfer.

The rumor has exactly one `p` recipient and the following required tags:

```text
p                       recipient proximity public key
file-type               original plaintext MIME type
encryption-algorithm    aes-gcm
decryption-key          32-byte lowercase hex key
decryption-nonce        12-byte lowercase hex nonce
x                       32-byte lowercase hex ciphertext hash
ox                      32-byte lowercase hex plaintext hash
size                    ciphertext byte length
plain-size              plaintext byte length
```

`size` must equal `plain-size + 16`. Optional existing kind-15 tags such as
`name`, `dim`, `thumbhash`, `duration`, `waveform`, reply, and subject retain
their current meanings. A filename is display metadata and is never used as a
filesystem path.

## Blossom upload identity and scheduling

Blossom upload authorization is signed by the same Proximity identity that
authors the Nearby rumor. The owning Nostr account signer is never used for a
Nearby file upload.

The Proximity identity service owns a reusable Proximity event signer. It may
sign the Blossom authorization event and future protocol events that explicitly
select the Proximity identity. It is never exposed through React state or UI
layers and never publishes a kind-10063 server list unless a later protocol
revision explicitly adds that behavior.

Before the kind-15 rumor enters the message outbox, durable state exists for:

- the plaintext managed file addressed by `ox`;
- the encrypted spool addressed by `x`;
- every `xs` upload target and its retry state;
- the complete kind-15 rumor and its recipient.

An `xs` target may return `404` before its queued upload succeeds. Receivers do
not permanently negative-cache that response. Every downloaded ciphertext is
verified against `x` regardless of its source.

After one target confirms the exact `x`, the ciphertext spool may be removed.
Other targets remain best-effort mirrors. A later retry may reconstruct the
same ciphertext under the restrictions above.

When Internet access appears reachable, the sender gives the queued Blossom
upload a bounded foreground opportunity before publishing the Nearby rumor. A
confirmed copy lets the receiver take the faster remote path immediately. An
offline hint, timeout, or upload failure never blocks the message: the durable
job keeps retrying in the background while the published rumor authorizes BLE
fallback.

## Capability and secure-record types

Capability bit `2` (`0x0000000000000004`) is `FILE_TRANSFER`. A peer that does
not select it never sends or accepts the records below and uses Blossom only.

| Type | Name | Direction |
| --- | --- | --- |
| `0x30` | `FILE_REQUEST` | Receiver to message sender |
| `0x31` | `FILE_ACCEPT` | Sender to receiver |
| `0x32` | `FILE_CHUNK` | Sender to receiver |
| `0x33` | `FILE_PROGRESS` | Receiver to sender |
| `0x34` | `FILE_COMPLETE` | Receiver to sender |
| `0x35` | `FILE_CANCEL` | Either direction |
| `0x36` | `FILE_REMOTE_AVAILABLE` | Sender to receiver |

All integers use network byte order. These payloads are carried only inside the
base protocol's Noise secure-record envelope.

### `FILE_REQUEST`

```text
transferId          bytes[16]
rumorId             bytes[32]
ox                  bytes[32]
resumeOffset        u64
desiredChunkSize    u32
desiredWindow       u16
reserved            u16 = 0
```

`transferId` is random for one request attempt. A resumed request after a new
connection uses a new transfer ID. `resumeOffset` is the receiver's durably
stored contiguous plaintext length. The desired chunk size is between 4 KiB
and 32 KiB. The desired window is between one and four chunks.

An exact repeated request for an active transfer ID is idempotent and returns
the same acceptance. Reusing an active transfer ID with different fields is an
invalid request. Records for a completed or cancelled transfer ID are ignored.

### `FILE_ACCEPT`

```text
transferId          bytes[16]
ox                  bytes[32]
plainSize           u64
acceptedOffset      u64
chunkSize           u32
windowChunks        u16
reserved            u16 = 0
```

The sender may reduce the chunk size or window. `acceptedOffset` is either the
requested offset or zero. The receiver truncates its partial file when zero is
returned. An offset greater than `plainSize` is invalid.

### `FILE_CHUNK`

```text
transferId          bytes[16]
offset              u64
dataLength          u32
data                bytes[dataLength]
```

`dataLength` is non-zero, no greater than the accepted chunk size, and never
extends past `plainSize`. Chunks are contiguous and ordered. An unexpected
offset cancels the transfer. A short final chunk is allowed.

### `FILE_PROGRESS`

```text
transferId          bytes[16]
receivedThrough     u64
```

`receivedThrough` is the first byte offset not yet durably appended. It is a
cumulative acknowledgement, never decreases, and never exceeds `plainSize`.
The receiver sends progress after at most `windowChunks` chunks or one second,
whichever happens first. The sender never has more than the accepted window in
flight.

### `FILE_COMPLETE`

```text
transferId          bytes[16]
ox                  bytes[32]
plainSize           u64
status              u8
reserved            bytes[7] = 0
```

Status `0` is `STORED`; status `1` is `ALREADY_PRESENT`. The receiver sends
`STORED` only after the size and SHA-256 checks succeed, the partial file is
atomically moved into the managed attachment store, and its database indexes
are durable.

### `FILE_CANCEL`

```text
transferId          bytes[16]
reason              u16
retryable           u8
reserved            u8 = 0
```

Reasons are:

| Value | Name | Meaning |
| --- | --- | --- |
| `0x0001` | `NOT_AVAILABLE` | Unified missing, unauthorized, deleted, or unavailable response |
| `0x0002` | `INVALID_REQUEST` | Malformed field, offset, state, or negotiation |
| `0x0003` | `BUSY` | Per-peer transfer capacity is occupied |
| `0x0004` | `INSUFFICIENT_STORAGE` | Receiver cannot reserve the required space |
| `0x0005` | `INTEGRITY_FAILURE` | Final plaintext size or `ox` mismatch |
| `0x0006` | `USER_CANCELLED` | Local user cancelled the transfer |
| `0x0007` | `TIMEOUT` | Transfer made no progress within the allowed interval |

The sender always uses `NOT_AVAILABLE` for authorization and existence
failures. It does not reveal whether another peer has access to the blob.

### `FILE_REMOTE_AVAILABLE`

```text
rumorId             bytes[32]
x                   bytes[32]
```

After an upload target confirms the exact ciphertext hash, the sender may use
this advisory record to wake a receiver that is waiting for remote fallback.
The receiver verifies that `rumorId`, `x`, and the stored manifest agree, then
resolves the manifest's existing `xs` hints. The record does not add or replace
locations and never removes the requirement to verify downloaded bytes.

## Authorization

`ox` is a content identifier, not a capability. A sender serves a request only
when all of the following hold:

1. The request arrived on a `READY`, unblocked, authenticated Noise session.
2. The authenticated peer is the sole `p` recipient of the referenced rumor.
3. The rumor exists in the local message database under `rumorId`.
4. The rumor is kind `15`, authored by the current local Proximity identity,
   and belongs to the authenticated peer's Nearby conversation.
5. The rumor's `ox` exactly equals the request's `ox`.
6. The conversation is owned by the current local Proximity identity and has
   not been deleted or made read-only by identity replacement.
7. A managed plaintext file exists for `ox` and its registered size matches the
   rumor's `plain-size`.

The lookup is by message primary key and peer, never a scan by `ox`. A newly
forwarded rumor creates a separate grant for its new recipient. Deleting the
message or conversation removes the grant. Rate limits, one active transfer per
peer, and global transfer limits apply before file I/O begins.

## Receiver storage and integrity

Before accepting bytes, the receiver verifies the manifest, checks available
disk space, and creates a hash-named partial file. Only contiguous application
chunks are persisted; native BLE fragments remain ephemeral.

Partial-transfer state contains the account, peer, rumor ID, `ox`, expected
plain size, current contiguous offset, partial filename, and last-progress
time. A missing or evicted partial file resets the offset to zero.

After the last byte:

1. Flush and close the partial file.
2. Verify its exact byte length against `plain-size`.
3. Compute SHA-256 off the JavaScript thread and compare it with `ox`.
4. Determine a safe MIME type from bytes, falling back to the declared type.
5. Atomically move the file into the existing `{ox}{extension}` managed store.
6. Record the BUD-10 URI-to-`ox` mapping and stored-file row.
7. Send `FILE_COMPLETE(STORED)`.

Any verification failure deletes the partial file and sends
`INTEGRITY_FAILURE`. The UI never opens an unverified partial file.

## Scheduling, liveness, and limits

- Chat messages, message acknowledgements, access, close, error, PING, and PONG
  have priority over file chunks.
- One BLE file transfer per peer and a bounded global number are active.
- A sender reads at most one negotiated chunk into memory per operation.
- File chunks use the same outbound serialization as every Noise record; nonce
  order is never parallelized.
- Any authenticated record counts as inbound liveness, but an active transfer
  does not suppress required control traffic.
- A transfer with no durable progress for 15 seconds is cancelled as retryable.
- A session rotation or disconnect preserves the partial file and resumes under
  a new Noise session and transfer ID.
- An incomplete partial with no durable progress for seven days is expired and
  removed on the next Nearby file-service start.
- Product policy may require confirmation or impose a lower size limit, but the
  wire format supports `u64` sizes.

## Remote retrieval

The receiver tries remote retrieval before starting BLE. It resolves every
`xs` in URI order and requests `GET /<x>.bin`. A response is accepted only when
its bytes hash to `x`. The receiver then decrypts `ciphertext || tag` with the
rumor key and nonce, verifies the plaintext against `ox` and `plain-size`, and
stores it through the same finalization path as a direct transfer.

A temporary `404` from a planned `xs` is retryable. Redirects and range requests
follow the applicable Blossom BUDs, but neither changes the required `x`
verification.

## Remote-to-direct fallback

One logical attachment fetch may have two independent partial representations:

- a plaintext partial addressed by `ox` from direct Nearby transfer;
- a ciphertext partial addressed by `x` from Blossom range retrieval.

The offsets are not interchangeable. Switching from a half-complete direct
transfer starts or resumes the ciphertext partial at its own offset, not at the
plaintext offset. AES-GCM decryption and `ox` verification happen only after the
complete ciphertext is present.

Only one byte source is active at a time. Network policy is checked first. A
remote failure, temporary absence after the bounded announcement wait, or an
offline hint starts or resumes authenticated BLE transfer. A verified remote
integrity failure may also fall back to BLE because the independently verified
plaintext representation can still be valid; if both sources fail, integrity
errors retain security precedence.

The ciphertext and plaintext partials remain independent. A failed remote
attempt retains its ciphertext offset while BLE uses its own plaintext offset,
and a later retry resumes the appropriate representation. Once either source
verifies and commits the managed file, both partials are removed.

An explicit user cancellation aborts the logical fetch and never starts the
next source. UI progress changes source and resets to that representation's
byte count; it never combines plaintext and ciphertext progress.

## Forwarding

Forwarding creates a new rumor and recipient authorization while reusing the
same immutable file manifest.

- A Nearby recipient may request plaintext from the forwarding device only if
  that device has the verified managed file and the new rumor grants access.
- A relay recipient uses the BUD-10 URI and encrypted metadata.
- If no `xs` has the ciphertext yet, relay forwarding waits for a successful
  upload before publishing the new rumor.
- If the spool is missing but verified plaintext is present, the forwarding
  device may reconstruct and verify the original ciphertext before upload.
- If neither verified plaintext nor retrievable ciphertext exists, forwarding
  fails without publishing a broken message.

## Security and privacy

- Noise authenticates and encrypts direct plaintext in transit; BLE pairing is
  not trusted.
- The Proximity upload signer prevents the owning Nostr account identity from
  appearing in upload authorization.
- The BUD-10 URI omits `as`; `xs` reveals planned storage providers to the peer.
- `rumorId + peer + ox` authorization prevents cross-conversation hash queries.
- Uniform `NOT_AVAILABLE` responses prevent a blob-existence oracle.
- `x` and `ox` verification are mandatory even after authenticated transport.
- Filenames, MIME declarations, offsets, sizes, and server hints are untrusted
  input and are strictly bounded.
- Plaintext partial files inherit app sandbox and OS data-protection controls
  and are deleted on cancellation, integrity failure, or expiry.

## Conformance

Tests must cover:

- strict kind-15 and BUD-10 parsing, local omission of `as` and `sz`, and valid
  inbound interoperability with both parameters;
- ciphertext `x`, plaintext `ox`, and both size invariants;
- reusable Proximity-signed upload authorization and original-account non-use;
- authorization success for the intended peer and indistinguishable denial for
  another peer, an unknown rumor, a deleted message, and a missing file;
- chunk bounds, contiguous offsets, cumulative windows, duplicate records, and
  invalid state transitions;
- disconnect and process-restart resume from a durable offset;
- final size/hash verification, atomic store insertion, deduplication, disk
  exhaustion, cancellation, and partial-file cleanup;
- message/control priority while a transfer is active;
- queued offline upload, bounded upload preference, temporary `404`, successful
  `xs` retrieval, spool reconstruction, `FILE_REMOTE_AVAILABLE`, remote-to-direct
  fallback, distinct
  partial offsets, explicit cancellation, and forwarding before and after
  upload.
