PsstPsst Nearby File Transfer
=============================

`draft` `optional`

## Abstract

This document specifies the `FILE_TRANSFER` extension to
[Nearby Messaging](./nearby-messaging.md) version `1`. It sends plaintext file
bytes through an authenticated Noise session. The associated NIP-17 kind-15
rumor describes both the direct plaintext and its encrypted Blossom
representation.

Peers negotiate this extension with capability bit `2`.

## File identities

One attachment has two hashes:

| Name | Definition | Use |
| --- | --- | --- |
| `ox` | SHA-256 of plaintext | Direct-transfer identity |
| `x` | SHA-256 of `ciphertext || tag` | Blossom blob identity |

The Blossom representation is `AES-256-GCM(plaintext)` with a 32-byte key,
12-byte nonce, and 16-byte authentication tag. Direct Nearby records carry
plaintext inside Noise encryption. BLE itself is not a confidentiality
boundary.

## Kind-15 offer

The kind-15 rumor is both the attachment offer and the authorization grant. Its
`content` is a [BUD-10](https://github.com/hzrd149/blossom/blob/master/buds/10.md)
URI:

```text
blossom:<x>.bin?xs=<server-1>&xs=<server-2>...
```

The unsigned rumor has exactly one `p` recipient and exactly one of each
required tag:

```json
{
  "id": "<rumor-id>",
  "pubkey": "<sender-proximity-pubkey>",
  "created_at": "<unix-timestamp>",
  "kind": 15,
  "tags": [
    ["p", "<recipient-proximity-pubkey>"],
    ["file-type", "<plaintext MIME type>"],
    ["encryption-algorithm", "aes-gcm"],
    ["decryption-key", "<32-byte lowercase hex key>"],
    ["decryption-nonce", "<12-byte lowercase hex nonce>"],
    ["x", "<32-byte lowercase hex ciphertext hash>"],
    ["ox", "<32-byte lowercase hex plaintext hash>"],
    ["size", "<ciphertext byte length>"],
    ["plain-size", "<plaintext byte length>"]
  ],
  "content": "blossom:<x>.bin?xs=<server-1>&xs=<server-2>..."
}
```

`size` MUST equal `plain-size + 16`. The URI hash MUST equal the `x` tag, the
extension MUST be `.bin`, and at least one valid `xs` server hint is required.
Each `xs` identifies a server intended to hold that exact ciphertext.

BUD-10 `as` and `sz` parameters are optional. When present, `as` is only a
discovery hint and `sz` MUST equal the authenticated `size` tag. Unknown URI
parameters are ignored.

An HTTP(S) URL or an invalid `blossom:` manifest does not authorize direct file
transfer. Existing optional kind-15 tags such as `name`, `dim`, `thumbhash`,
`duration`, `waveform`, reply, and `subject` keep their meanings.

Any ciphertext interpreted from the manifest MUST hash to `x`. After decryption,
the plaintext MUST match `plain-size` and `ox`. These integrity requirements do
not prescribe when or whether a client retrieves the Blossom representation.

## Records

All records use the Nearby secure-record envelope and network byte order. `u64`
values MUST NOT exceed `2^53 - 1`.

| Type | Name | Direction |
| --- | --- | --- |
| `0x30` | `FILE_REQUEST` | Receiver to sender |
| `0x31` | `FILE_ACCEPT` | Sender to receiver |
| `0x32` | `FILE_CHUNK` | Sender to receiver |
| `0x33` | `FILE_PROGRESS` | Receiver to sender |
| `0x34` | `FILE_COMPLETE` | Receiver to sender |
| `0x35` | `FILE_CANCEL` | Either direction |
| `0x36` | `FILE_REMOTE_AVAILABLE` | Sender to receiver |

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

`transferId` is random for one request attempt. `resumeOffset` is the first
plaintext byte requested and may resume a contiguous partial transfer. Chunk
size is 4–32 KiB and window size is one to four chunks. A new connection uses a
new transfer ID.

Repeating the same active transfer ID and fields is idempotent. Reusing an
active ID with different fields is invalid.

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

The sender MAY reduce the requested chunk or window size. `acceptedOffset` is
the requested offset or zero. The receiver discards its partial plaintext when
zero is returned. The offset MUST NOT exceed `plainSize`.

### `FILE_CHUNK`

```text
transferId          bytes[16]
offset              u64
dataLength          u32
data                bytes[dataLength]
```

Chunks are contiguous and ordered. `dataLength` is non-zero, no larger than the
accepted chunk size, and MUST NOT extend beyond `plainSize`. An unexpected
offset invalidates the transfer.

### `FILE_PROGRESS`

```text
transferId          bytes[16]
receivedThrough     u64
```

`receivedThrough` is the first plaintext offset not yet accepted. It is
cumulative, never decreases, and MUST NOT exceed `plainSize`. The sender keeps
no more than `windowChunks` unacknowledged chunks in flight.

### `FILE_COMPLETE`

```text
transferId          bytes[16]
ox                  bytes[32]
plainSize           u64
status              u8
reserved            bytes[7] = 0
```

Status `0` is `STORED`; status `1` is `ALREADY_PRESENT`. A receiver sends
`STORED` only after verifying the complete plaintext length and `ox` hash.

### `FILE_CANCEL`

```text
transferId          bytes[16]
reason              u16
retryable           u8
reserved            u8 = 0
```

| Value | Name | Meaning |
| --- | --- | --- |
| `0x0001` | `NOT_AVAILABLE` | Missing, unauthorized, deleted, or unavailable |
| `0x0002` | `INVALID_REQUEST` | Invalid field, offset, state, or negotiation |
| `0x0003` | `BUSY` | Transfer capacity is occupied |
| `0x0004` | `INSUFFICIENT_STORAGE` | Receiver cannot reserve space |
| `0x0005` | `INTEGRITY_FAILURE` | Final size or `ox` mismatch |
| `0x0006` | `USER_CANCELLED` | Local user cancelled |
| `0x0007` | `TIMEOUT` | No progress before the peer's deadline |

Senders MUST use `NOT_AVAILABLE` for both existence and authorization failures
so the response does not become a file-existence oracle.

### `FILE_REMOTE_AVAILABLE`

```text
rumorId             bytes[32]
x                   bytes[32]
```

This advisory tells the receiver that one planned Blossom location now has the
ciphertext. The receiver MUST verify both fields against its stored offer. The
record does not add a server location or relax hash verification. A receiver
MAY ignore the advisory; the protocol does not prescribe source selection.

## Direct exchange

```text
Receiver                                      Sender
    |  FILE_REQUEST(rumorId, ox, offset)          |
    |-------------------------------------------->|
    |  FILE_ACCEPT(offset, chunk, window)         |
    |<--------------------------------------------|
    |  FILE_CHUNK(offset, data)                   |
    |<--------------------------------------------|
    |  FILE_PROGRESS(receivedThrough)             |
    |-------------------------------------------->|
    |                    ...                      |
    |  FILE_COMPLETE(ox, plainSize, STORED)       |
    |-------------------------------------------->|
```

A sender serves a request only when the Noise session is authenticated and
accepted, the requester is the rumor's sole `p` recipient, the sender authored
that kind-15 rumor with the authenticated proximity identity, `rumorId` and
`ox` match, and the exact verified plaintext is available.

After interruption, the receiver starts a new transfer ID and supplies its
contiguous plaintext offset. Completed and cancelled transfer IDs are not
reused.

## Security

The message grant, not knowledge of `ox`, authorizes plaintext access. Noise
protects direct plaintext in transit; `x`, `ox`, and size checks remain
mandatory even after authenticated transport.
