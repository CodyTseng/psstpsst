# Nearby Messaging Implementation

The interoperable wire format is specified in
[`../protocols/nearby-messaging.md`](../protocols/nearby-messaging.md).

Nearby uses a device-local proximity identity rather than the owning Nostr
identity. Private identity keys remain in secure storage. Session cipher state
is exposed to shared core code only through opaque asynchronous handles: mobile
uses the native Noise-C module, while Electron uses a dedicated worker.

One process-wide proximity runtime owns BLE callbacks, connection generations,
packet reassembly, the outbound FIFO, duplicate-connection election, access
requests, liveness, and durable message acknowledgement. Async work is scoped to
the endpoint generation that started it so a late callback cannot mutate a
replacement connection.

## Radio and connection lifecycle

When Nearby is enabled, the app advertises in foreground sessions. Ordinary
foreground entry performs a bounded scan, the Nearby screen scans continuously,
and an open offline Nearby conversation may perform bounded retry scans.
Background radio operation is not required for correctness.

Radio presence and authenticated connection liveness are separate. Only BLE
advertisement scan results refresh list presence. Signal becomes unavailable
after five seconds without an advertisement; an unlinked or disconnected peer
leaves the list after 15 seconds. Cached connection RSSI, Profile reads, and
protocol traffic never extend radio presence.

Ready sessions send `PING` after five idle seconds and require authenticated
traffic within 15 seconds. A trusted peer with a live connection remains
presented after radio presence expires, with unavailable signal, until the
connection closes.

## Runtime ownership and limits

Logical connection phases are `CONNECTED`, `HANDSHAKING`, `AUTHENTICATED`,
`ELECTING`, `AWAITING_ACCESS`, `ACCESS_REJECTED`, `READY`, and `CLOSED`.
Complete packets are processed serially per endpoint. Repeated native
connection callbacks are idempotent for an active generation, and a late
duplicate never replaces an endpoint already handling access or ready traffic.
At most one reverse BLE connection becomes canonical for a peer.

The runtime permits at most 16 unauthenticated endpoint contexts, 64 total
contexts, and 16 pending first-contact requests. Before authentication,
reassembly permits at most 128 KiB and 16,384 fragments per packet, four packets
and 256 KiB per endpoint, and 32 packets and 1 MiB globally. Incomplete packets
expire after 60 seconds without activity.

A secure session rotates before 24 hours, `2^20` records in either direction,
64 GiB of plaintext in either direction, or a lower native Noise limit.

## Persistence and recovery

Outgoing rumors enter a durable outbox before transmission. Missing or
retryable acknowledgements return work to the queue. BLE fragments, endpoint
IDs, session state, and plaintext temporary buffers are not persisted.

The receiver validates the rumor ID, authenticated author, sole recipient,
supported content, timestamp, and trust relationship before storage. It sends
`STORED` only after commit and `DUPLICATE` only for an already committed rumor.
Profile updates change the durable peer and conversation label without creating
a message or unread state.

Every Nearby conversation and message records the local proximity identity that
owns it. Replacing that identity leaves old history readable but read-only;
rotating only the Noise key retains ownership.

## Platform security

Private key copies, Noise chaining keys, and transport keys are released on
completion, failure, disconnect, account switch, radio shutdown, and expiry.
Mobile keeps Noise handshake and transport state behind opaque native handles
and runs Noise-C work outside the JavaScript thread. Electron keeps equivalent
state in a dedicated worker with best-effort zeroization.

The application treats the pairing code only as a first-contact UI aid. It does
not claim anonymity, traffic-analysis resistance, or proof of physical distance.

## Verification

Implementation conformance is covered by deterministic Noise fixtures, Profile
binding tests, record replay and tamper tests, BLE fragmentation tests,
capability tests, access-state tests, rumor validation, durable retry, and
duplicate-connection election.
