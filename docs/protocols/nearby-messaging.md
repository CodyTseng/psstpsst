PsstPsst Nearby Messaging
=========================

`draft` `optional`

## Abstract

This document specifies PsstPsst Nearby Messaging version `1`: discovery,
authentication, access approval, and Nostr rumor exchange over Bluetooth Low
Energy (BLE). BLE is only the byte transport. Noise XX authenticates peers and
protects application records.

Versions other than `1` are unsupported. There is no downgrade, legacy decoder,
multi-hop forwarding, or distance-bounding guarantee.

## Identities

Each endpoint has a BIP-340 secp256k1 proximity identity and an X25519 Noise
static key. These keys are independent of the user's Nostr account identity.
The proximity key authorizes the Noise key with:

```text
bindingMessage = SHA256(
  UTF8("PsstPsst Nearby Noise Binding/1") ||
  proximityPublicKey ||
  noiseStaticPublicKey
)

noiseBindingSignature = BIP340Sign(proximityPrivateKey, bindingMessage)
```

The proximity public key is the peer identifier and the author of Nearby
rumors. A peer MUST validate the signature before starting a handshake and MUST
later compare the Noise-authenticated static key with the signed public key.

## BLE bearer

| Item | UUID | Operations |
| --- | --- | --- |
| Service | `45D8B02F-6D80-4FC6-914E-B85FCD0440D3` | Advertise |
| Profile | `55980CEE-27E5-48A9-BF1C-AB5DA34B4402` | Read, notify |
| Control | `86A4C105-9A0E-4144-BCA1-40E7C78A1D93` | Write with response, indicate |

The scanner is the Central and Noise Initiator. The advertiser is the
Peripheral and Noise Responder. The Central enables Profile notifications and
Control indications before sending `CLIENT_HELLO`. Bluetooth pairing and
bonding are not protocol requirements.

All integers in this document use network byte order.

## Public Profile

```text
profileVersion          u8 = 1
proximityPublicKey      bytes[32]
noiseStaticPublicKey    bytes[32]
noiseBindingSignature   bytes[64]
capabilities            u64
nameLength              u8
name                    UTF-8 bytes[nameLength]
```

`nameLength` MUST be at most 64 bytes. The name is a public label and is not an
identity. Invalid UTF-8, an invalid proximity key, or an invalid binding
signature invalidates the Profile.

When the Profile value changes, the Peripheral notifies subscribed Centrals
with the complete updated Profile value.

Capability bits are:

| Bit | Name | Meaning |
| --- | --- | --- |
| `0` | `MESSAGE` | Exchange Nostr rumors; required |
| `1` | `PROFILE_UPDATE` | Receive encrypted name updates |
| `2` | `FILE_TRANSFER` | Use the direct-file extension |

Unknown bits MUST be ignored and MUST NOT be selected.

## Noise handshake

The fixed suite and prologue are:

```text
Noise_XX_25519_ChaChaPoly_SHA256
UTF8("PsstPsst Nearby/1")
```

The exchange is:

```text
Initiator                                      Responder
    |  CLIENT_HELLO: Noise message A (e)            |
    |---------------------------------------------->|
    |  SERVER_HELLO: Noise message B (e, ee, s, es) |
    |<----------------------------------------------|
    |  CLIENT_AUTH: Noise message C (s, se)         |
    |---------------------------------------------->|
    |  encrypted ACCESS_REQUEST / ACCESS_RESULT     |
```

Noise application payloads are:

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

The Responder selects only capabilities offered by both Profiles. `MESSAGE`
MUST be selected. `maxRecordSize` is between 512 and 65,583 bytes inclusive;
the selected value MUST NOT exceed the Initiator's proposal.

The unencrypted handshake envelope is:

```text
version         u8 = 1
type            u8
flags           u16 = 0
payloadLength   u32
payload         bytes[payloadLength]
```

The first 32 bytes of Noise message A are the handshake ID. `SERVER_HELLO` and
`CLIENT_AUTH` prefix that ID to Noise messages B and C. A response with another
ID is discarded. The ID routes concurrent or stale BLE packets; it does not
replace Noise transcript authentication.

## Secure records

After Noise `split()`, the Initiator uses the first cipher state for sending and
the second for receiving. The Responder uses the reverse assignment. The final
Noise handshake hash is the 32-byte session ID.

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

The 48-byte header is ChaCha20-Poly1305 additional authenticated data. The
explicit sequence begins at zero in each direction and MUST equal the next
expected value. A wrong session ID, sequence, or authentication tag invalidates
the record.

| Type | Name | Direction | Payload |
| --- | --- | --- | --- |
| `0x01` | `CLIENT_HELLO` | Initiator → Responder | Noise message A |
| `0x02` | `SERVER_HELLO` | Responder → Initiator | handshake ID, Noise message B |
| `0x03` | `CLIENT_AUTH` | Initiator → Responder | handshake ID, Noise message C |
| `0x10` | `ACCESS_REQUEST` | Initiator → Responder | empty |
| `0x11` | `ACCESS_RESULT` | Responder → Initiator | decision `u8` |
| `0x12` | `PING` | Either | empty |
| `0x13` | `PONG` | Either | empty |
| `0x14` | `PROFILE_UPDATE` | Either | name length `u8`, UTF-8 name |
| `0x20` | `MESSAGE` | Either | canonical UTF-8 rumor JSON |
| `0x21` | `MESSAGE_ACK` | Receiver → sender | rumor ID, status, error code |
| `0x30`–`0x36` | file records | See file protocol | See [Nearby File Transfer](./nearby-file-transfer.md) |
| `0x7e` | `ERROR` | Either | error code, retry flag, context |
| `0x7f` | `CLOSE` | Either | error code `u16` |

`ACCESS_RESULT` decisions are `0` accepted, `1` declined, `2` blocked, and `3`
expired. Only accepted sessions exchange messages.

`PROFILE_UPDATE` is valid only when capability bit `1` was selected. It changes
the authenticated peer's label, not its identity. Its payload uses the same
UTF-8 and 64-byte limit as the Profile name.

File records are valid only when capability bit `2` was selected.

## Message exchange

`MESSAGE` contains one unsigned Nostr rumor serialized as canonical JSON. It
MUST contain exactly `id`, `pubkey`, `created_at`, `kind`, `tags`, and `content`.
The supported kinds are `14`, `15`, and `7`. It MUST have exactly one valid `p`
recipient tag. The authenticated sender MUST equal `pubkey`, and the receiving
peer MUST equal the `p` recipient. The `id` MUST be the NIP-01 hash of the
rumor. The payload MUST be compact UTF-8 JSON whose parsed value serializes to
the same bytes under ECMAScript `JSON.stringify`. Content is limited to 60 KiB
of UTF-8, a rumor to 256 tags, a tag to 16 parts, and each tag part to 4 KiB of
UTF-8.

The receiver validates and stores the rumor before replying:

```text
rumorId        bytes[32]
status         u8
errorCode      u16
```

Statuses are `0` stored, `1` duplicate, and `2` rejected. `errorCode` MUST be
zero for `STORED` and `DUPLICATE`; `REJECTED` carries the applicable error code.
A transport write is not delivery; `STORED` or `DUPLICATE` is the delivery
acknowledgement.

A peer receiving `PING` MUST answer with `PONG`. Either peer may send `CLOSE`.
A new Noise handshake is required after a session expires or any
record-authentication failure.

## BLE fragmentation

Every encoded handshake packet or secure record is fragmented as:

```text
packetId        u64
fragmentIndex   u16
fragmentCount   u16
fragmentBody    remaining bytes
```

`packetId` increases per sender and BLE connection. Fragments are grouped by
connection and packet ID. Indexes start at zero. Duplicate identical fragments
may be ignored; inconsistent headers or conflicting duplicate bodies invalidate
the packet.

Each fragment, including its 12-byte header, MUST be no larger than
`min(512, ATT_MTU - 3)` bytes.

## Errors and security

`ERROR` payloads contain:

```text
errorCode      u16
retryable      u8
contextLength  u16
context        UTF-8 bytes[contextLength]
```

`retryable` is `0` or `1`; `contextLength` MUST NOT exceed 512 bytes. The
context is informational and MUST NOT be required for protocol decisions.

Error codes are: `1` unsupported version, `2` invalid packet, `3` invalid
handshake, `4` authentication failed, `5` access denied, `6` not ready, `7`
payload too large, `8` busy, `9` unsupported type, `10` invalid event, `11`
storage failed, `12` rate limited, `13` timeout, `14` duplicate connection, and
`15` session expired.

Invalid Noise messages, identity bindings, AEAD tags, and replayed sequences
SHOULD close without revealing diagnostic details. Before authentication, the
Profile, radio metadata, Initiator Profile, Noise ephemeral keys, and traffic
shape are observable. After authentication, record types, lengths, timing, and
BLE fragment counts remain observable. Noise authenticates the endpoint but
does not prove physical distance or provide anonymity.
