# Nearby Messaging Protocol

## Status and scope

This document specifies the sole supported PsstPsst Nearby Messaging protocol,
version `1`. Unreleased prototypes are not protocol versions and have no legacy
decoder, downgrade, fallback, or migration path. Profiles, handshakes, and
secure records carrying any other version are rejected.

Bluetooth Low Energy (BLE) is the first transport. Identity, authorization,
secure records, delivery acknowledgement, and durable retry are independent of
BLE so another local duplex transport can carry the same application protocol.
The protocol does not provide multi-hop forwarding or distance bounding.

## Identities and keys

Each signed-in account has two persistent, device-local Nearby key pairs
(proximity identity and Noise static). Handshakes also create ephemeral keys
and derive session transport keys:

| Key | Primitive | Lifetime | Purpose |
| --- | --- | --- | --- |
| Proximity identity | BIP-340 secp256k1 | Until locally replaced | Public peer and conversation identity; signs the Noise key binding |
| Noise static key | X25519 | Until locally replaced | Authenticates Noise XX sessions |
| Noise ephemeral key | X25519 | One handshake | Forward secrecy |
| Noise transport keys | ChaCha20-Poly1305 | One session | Confidentiality, integrity, and replay protection |

Both private keys are stored in secure storage. They are not published to Nostr
relays or synchronized to another device. The owning Nostr account key never
appears in Nearby discovery or authentication.

The 32-byte BIP-340 proximity public key is intentionally public and remains the
database identity for a Nearby conversation. The 32-byte Noise static public key
is also public. It is bound to the proximity identity by:

```text
bindingMessage = SHA256(
  UTF8("PsstPsst Nearby Noise Binding/1") ||
  proximityPublicKey ||
  noiseStaticPublicKey
)

noiseBindingSignature = BIP340Sign(proximityPrivateKey, bindingMessage)
```

The signature proves that the holder of the proximity private key authorized
that Noise static key. Noise XX then proves possession of the corresponding
Noise private key. A display name is only a public label and is not unique.

If secure-storage loss replaces the proximity identity, history owned by the
old identity remains readable but cannot author new messages until an explicit
migration mechanism exists. Losing only the Noise static key rotates the Noise
binding under the same proximity identity and does not change conversation
ownership.

## Radio lifecycle and BLE service

When Nearby is enabled, PsstPsst advertises during foreground sessions. Each
foreground session performs a bounded scan, the Nearby screen scans
continuously, and an open offline Nearby conversation may perform bounded retry
scans. Background operation is not required for correctness.

| Item | UUID | Operations | Purpose |
| --- | --- | --- | --- |
| Service | `45D8B02F-6D80-4FC6-914E-B85FCD0440D3` | Advertise | Discover PsstPsst peers |
| Profile | `55980CEE-27E5-48A9-BF1C-AB5DA34B4402` | Read / notify | Public identity and live public updates |
| Control | `86A4C105-9A0E-4144-BCA1-40E7C78A1D93` | Write with response / indicate | Handshake and authenticated records |

The Central enables Profile notifications and Control indications before
surfacing the peer Profile or sending the first handshake packet. The protocol
does not require Bluetooth pairing or bonding; GATT is treated as an
unauthenticated plaintext transport.

Radio presence and authenticated connection state are independent. Only an OS
advertisement scan refreshes list presence. Five seconds without an
advertisement makes signal unavailable; 15 seconds removes an unlinked or
disconnected peer. Profile reads, RSSI from a cached connection, handshake
packets, and secure records do not refresh presence.

## Public Profile

All integers use network byte order. The Profile value is:

```text
profileVersion          u8 = 1
proximityPublicKey      bytes[32]
noiseStaticPublicKey    bytes[32]
noiseBindingSignature   bytes[64]
capabilities            u64
nameLength              u8
name                    UTF-8 bytes[nameLength]
```

`nameLength` is at most 64 bytes. Invalid UTF-8, an invalid proximity key, or an
invalid Noise binding signature makes the Profile invalid. Unknown capability
bits are ignored during discovery and are never selected during negotiation.

Changing the local public name updates the readable Profile and notifies
subscribed Centrals. That notification is public discovery data. A negotiated
secure `PROFILE_UPDATE` record carries the same change authoritatively to ready
sessions.

## Noise XX handshake

The fixed handshake name is:

```text
Noise_XX_25519_ChaChaPoly_SHA256
```

The fixed prologue is `UTF8("PsstPsst Nearby/1")`. Cipher-suite negotiation,
fallback, 0-RTT, and session resumption are not supported.

The scanner is the Noise Initiator and the advertiser is the Responder. The
three standard XX messages are carried by application handshake packet types:

```text
Initiator                                      Responder
    |  read and validate public Profile            |
    |---------------------------------------------->|
    |  CLIENT_HELLO: Noise message A (e)            |
    |---------------------------------------------->|
    |  SERVER_HELLO: Noise message B (e, ee, s, es) |
    |<----------------------------------------------|
    |  CLIENT_AUTH: Noise message C (s, se)         |
    |---------------------------------------------->|
    |  split Noise transport cipher states         |
    |  duplicate-connection election               |
    |  encrypted ACCESS_REQUEST / ACCESS_RESULT     |
    |                 READY                         |
```

The application payload encrypted or hashed by each Noise message is:

```text
message A payload:
  protocolVersion       u8 = 1
  profileLength         u16
  initiatorProfile      bytes[profileLength]
  maxRecordSize         u32

message B payload:
  protocolVersion       u8 = 1
  profileLength         u16
  responderProfile      bytes[profileLength]
  selectedCapabilities  u64
  maxRecordSize         u32

message C payload:
  empty
```

Message A is visible on the wire but is included in the Noise transcript.
Message B's payload and the responder static key are encrypted. Message C's
static key is encrypted. After reading message B or C, the receiver must compare
the Noise-authenticated remote static key with `noiseStaticPublicKey` in the
remote Profile. The Profile's BIP-340 binding signature must already be valid.
Any mismatch aborts the handshake.

The Responder selects only capabilities offered by both Profiles. `MESSAGE` is
required. The proposed and selected `maxRecordSize` values are between 512 and
65,583 bytes inclusive. Noise ciphertext is limited to 65,535 bytes; the larger
record limit includes the 48-byte application header that is authenticated as
additional data but is outside the Noise ciphertext.

### Handshake envelope and stale-packet identifier

```text
version         u8 = 1
type            u8
flags           u16 = 0
payloadLength   u32
payload         bytes[payloadLength]
```

Only `CLIENT_HELLO`, `SERVER_HELLO`, and `CLIENT_AUTH` use this unencrypted
envelope. `CLIENT_HELLO.payload` is Noise message A. Its first 32 bytes, the
initiator ephemeral public key, are the handshake ID. `SERVER_HELLO.payload` and
`CLIENT_AUTH.payload` prefix that 32-byte ID before Noise messages B and C.
The prefix is routing metadata; Noise authenticates the complete handshake
independently.

A response with a different handshake ID is discarded. A newer
`CLIENT_HELLO` may replace an unauthenticated Responder attempt on the same
physical endpoint. Exact retransmissions are ignored; conflicting duplicates
close the logical connection. Handshake packets are not accepted after Noise
transport state is established.

| Type | Name | Envelope |
| --- | --- | --- |
| `0x01` | `CLIENT_HELLO` | Handshake |
| `0x02` | `SERVER_HELLO` | Handshake |
| `0x03` | `CLIENT_AUTH` | Handshake |
| `0x10` | `ACCESS_REQUEST` | Secure record |
| `0x11` | `ACCESS_RESULT` | Secure record |
| `0x12` | `PING` | Secure record |
| `0x13` | `PONG` | Secure record |
| `0x14` | `PROFILE_UPDATE` | Secure record |
| `0x20` | `MESSAGE` | Secure record |
| `0x21` | `MESSAGE_ACK` | Secure record |
| `0x30`–`0x36` | File transfer records | Secure record |
| `0x7e` | `ERROR` | Secure record |
| `0x7f` | `CLOSE` | Secure record |

Capability bit `0` is `MESSAGE`; bit `1` is `PROFILE_UPDATE`; bit `2` is
`FILE_TRANSFER`. The file records and their negotiation rules are specified in
[`nearby-file-transfer.md`](./nearby-file-transfer.md). Other bits are reserved
and sent as zero.

## Secure record layer

After `split()`, the Initiator uses the first Noise cipher state for sending and
the second for receiving; the Responder uses the reverse assignment. The final
Noise handshake hash is the non-secret session ID.

```text
version         u8 = 1
type            u8
flags           u16 = 0
sessionId       bytes[32]
sequence        u64
payloadLength   u32
ciphertext      bytes[payloadLength]
tag             bytes[16]
```

The 48-byte header is ChaCha20-Poly1305 additional authenticated data. Noise's
directional cipher nonce starts at zero and increments once per record. The
explicit sequence must equal the next expected value and is covered by the
authentication tag. Structural checks, the session ID, and the expected
sequence may reject a record before decryption. A record is accepted only
after AEAD authenticates the complete header and ciphertext.

Each endpoint has one outbound FIFO. The platform Noise state owner serializes
operations per opaque session handle, so sealing one record advances the nonce
before another seal can run. Any seal or open failure invalidates the session.

A session closes and performs a fresh handshake before the earliest of:

- 24 hours since handshake completion;
- `2^20` secure records in either direction;
- 64 GiB of plaintext payload in either direction;
- a lower limit imposed by the Noise implementation.

## Access, liveness, and delivery

Noise authentication is automatic and does not create a UI prompt. First-contact
consent is an application decision after the handshake:

- a trusted, unblocked peer is accepted automatically;
- an unknown peer creates one approval request;
- a blocked peer receives `ACCESS_RESULT(BLOCKED)` and is closed;
- accepting persists the relationship before returning `ACCEPTED`;
- declining keeps the authenticated connection briefly so the Initiator may
  explicitly retry without another radio round trip.

The pairing code is derived from the authenticated session ID and the sorted
proximity public keys. It is a UI aid for the pending request, not part of Noise
authentication.

Ready sessions send `PING` every five seconds when idle and require authenticated
traffic within 15 seconds. Timers do not define radio presence.

Nearby messages carry canonical unsigned Nostr rumor JSON. Kinds `14`, `15`,
and `7` are supported. The authenticated session must match the rumor author and
sole `p` recipient. The receiver validates and commits the rumor before sending
`MESSAGE_ACK(STORED)`; duplicates receive `MESSAGE_ACK(DUPLICATE)`. Submission
to BLE is never treated as delivery.

Nearby version `1` transfers kind-15 plaintext bytes directly when both peers
select `FILE_TRANSFER`. Authorization, resume, and deferred-Blossom rules are
specified in [`nearby-file-transfer.md`](./nearby-file-transfer.md). Without the
capability, the same kind-15 rumor remains remotely retrievable through its
Blossom manifest.

Outgoing work is written to the durable outbox before transmission. Missing or
retryable acknowledgements return it to the queue with bounded backoff. BLE
fragments, endpoint identifiers, Noise state, and plaintext temporary buffers
are never persisted.

## BLE fragmentation

Every complete handshake packet or secure record is fragmented after encoding:

```text
packetId        u64
fragmentIndex   u16
fragmentCount   u16
fragmentBody    remaining bytes
```

`packetId` increases per sender and physical endpoint. Reassembly is keyed by
`(endpoint, generation, packetId)`. Identical duplicate fragments are ignored;
conflicting bodies, inconsistent counts, invalid indexes, completed-ID reuse,
or overflow discard the packet.

Each fragment, including its 12-byte header, is bounded to
`min(512, ATT_MTU - 3)` bytes. The 512-byte GATT attribute-value limit is
universal, while the negotiated MTU can require a smaller frame.

Before authentication, reassembly is bounded to 128 KiB per logical packet,
16,384 fragments per packet, four incomplete packets and 256 KiB per endpoint,
32 incomplete packets and 1 MiB globally, and 60 seconds of inactivity.

## Connection invariants

The logical states are `CONNECTED`, `HANDSHAKING`, `AUTHENTICATED`, `ELECTING`,
`AWAITING_ACCESS`, `ACCESS_REJECTED`, `READY`, and `CLOSED`.

- Complete inbound packets are processed serially per endpoint.
- One process-wide service owns the receive dispatcher and outbound FIFO.
- Repeated native `connected` callbacks are idempotent for an active context.
- Every callback is scoped to a monotonically increasing native generation.
- Async handshake work retains its originating context and generation.
- At most one reverse BLE connection becomes canonical for a peer.
- An endpoint already in access or ready state is never replaced by a late
  duplicate.
- At most 16 unauthenticated and 64 total endpoint contexts are active.
- At most 16 incoming first-contact requests are pending.

## Error behavior and security notes

Stable error codes cover unsupported version, invalid packet or handshake,
authentication failure, access denial, wrong state, oversized payload, busy or
rate-limited peers, unsupported types, invalid events, storage failure, timeout,
duplicate connection, and session expiration.

Invalid AEAD tags, replayed sequences, invalid Noise messages, and identity-key
mismatches close silently. Unauthenticated endpoints never receive secure error
details. Invalid rumors receive a rejection acknowledgement only when their ID
can be trusted; otherwise the session sends `ERROR(INVALID_EVENT)` after
authentication.

Private and ephemeral key copies, Noise chaining keys, and transport keys are
zeroized by the native mobile state owner on completion, failure, disconnect,
account switch, radio shutdown, or expiration. Electron isolates this state in
a worker and applies best-effort zeroization before releasing it. Copies made by
runtime bridges and garbage-collected heaps remain a reason to keep long-lived
private keys in OS secure storage.

Public proximity and Noise keys permit passive correlation while the device is
discoverable. This is an intentional product trade-off. Noise authenticates and
encrypts the connection but cannot prove physical distance; a real-time relay
can make a remote peer appear locally reachable.

Before Noise authentication, the service UUID, radio timing and signal, complete
Public Profile, handshake envelope, Noise ephemeral public keys, and message A
payload are observable. Message A therefore exposes the Initiator Profile and
proposed record limit even though Noise includes both in its authenticated
transcript.

After authentication, application payloads are confidential but traffic is not
opaque. The secure-record header exposes the record type, non-secret session ID,
sequence, and exact payload length; BLE framing additionally exposes packet and
fragment counts, direction, and timing. The pairing code is also non-secret and
must remain only a UI aid. Implementations must not describe Nearby as anonymous
or resistant to traffic analysis.

## Conformance

Protocol tests must cover:

- Profile encoding and the BIP-340 Noise-key binding;
- rejection of every non-v1 Profile, handshake, and secure record without
  fallback;
- deterministic byte fixtures for all three Noise XX messages and the final
  handshake hash;
- remote static-key comparison and tamper failure;
- directional secure records, sequence replay, wrong-session rejection, and
  AEAD failure;
- BLE fragmentation bounds and conflicting fragments;
- capability downgrade, wrong identity, access-state violations, and invalid
  rumor JSON;
- durable retry and duplicate-connection election.

Mobile uses a vendored, suite-restricted Noise-C core behind an Expo native
module. Handshake and transport states stay behind opaque handles, and Expo
`AsyncFunction` calls execute away from the JavaScript thread. Electron owns the
same state machine in a dedicated worker thread using `@libp2p/noise`; its
renderer and main event loops do not perform Noise cryptography. Deterministic
cross-implementation fixtures keep both backends wire-compatible. PsstPsst owns
the record header, BLE framing, Profile binding, application payloads, access
policy, and durable delivery semantics around Noise XX.
