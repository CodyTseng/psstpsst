PsstPsst NIP-4E Profile
=======================

`draft` `optional`

This document specifies PsstPsst's profile of the draft
[NIP-4E proposal](https://github.com/nostr-protocol/nips/pull/1647). It separates
the Nostr identity key from the key used for NIP-44 encryption and synchronizes
the encryption key between devices. Its use in message envelopes is specified
in [PsstPsst NIP-17 Extensions](./nip17-extensions.md).

| Event | Purpose |
| --- | --- |
| kind `10044` | Announce the current encryption public key |
| kind `4454` | Request the encryption private key on another device |
| kind `4455` | Transfer the encryption private key to that device |

## Encryption-key announcement

The identity publishes its current encryption public key in a replaceable kind
`10044` event signed by the identity key:

```json
{
  "id": "<event-id>",
  "kind": 10044,
  "pubkey": "<identity-pubkey>",
  "created_at": "<unix-timestamp>",
  "tags": [["n", "<encryption-pubkey>"]],
  "content": "",
  "sig": "<identity-signature>"
}
```

The first `n` value MUST be a 32-byte lowercase hexadecimal secp256k1 public
key. A sender resolves the recipient's latest valid kind `10044` before
encrypting to that recipient. Republishing kind `10044` with another `n` value
rotates the encryption key without changing the account identity.

## Encryption-key synchronization

Kinds `4454` and `4455` transfer the current encryption private key between
devices using the same identity.

### Request

The requesting device selects a client key pair and publishes:

```json
{
  "id": "<event-id>",
  "pubkey": "<identity-pubkey>",
  "created_at": "<unix-timestamp>",
  "kind": 4454,
  "tags": [
    ["P", "<requester-client-pubkey>"],
    ["pubkey", "<requester-client-pubkey>"],
    ["relay", "<response-relay>"],
    ["n", "<requested-encryption-pubkey>"]
  ],
  "content": "",
  "sig": "<identity-signature>"
}
```

`P` is the NIP-4E client public key. `pubkey` is an optional compatibility
alias; when both are present they MUST be equal. Each `relay` value is a relay
on which the requester accepts the response. When `n` is present, the responder
transfers that encryption key; otherwise it transfers its current key.

The requester publishes kind `4454` to its advertised relays. Existing devices
subscribe for kind `4454` events authored by the shared identity.

### Response

After authorizing the request, another device selects a sender client key pair
and publishes:

```json
{
  "id": "<event-id>",
  "pubkey": "<identity-pubkey>",
  "created_at": "<unix-timestamp>",
  "kind": 4455,
  "tags": [
    ["P", "<sender-client-pubkey>"],
    ["p", "<identity-pubkey>"],
    ["p", "<requester-client-pubkey>"]
  ],
  "content": "<nip44-encrypted-private-key>",
  "sig": "<identity-signature>"
}
```

The content plaintext is the 32-byte encryption private key encoded as 64
lowercase hexadecimal characters. It is encrypted with NIP-44 using the
sender client private key and requester client public key. The responder
publishes the response to one or more relays shared with the requester and
SHOULD include valid `relay` hints from the request when present.

The requester subscribes for kind `4455` events authored by the shared identity
and `p`-tagged with its client public key. It obtains the sender client
public key from `P`, decrypts the content, derives the transferred public key,
and accepts the key only when that public key equals the current kind `10044`
`n` value. Undecryptable and non-matching responses are ignored.

The identity `p` tag is emitted by PsstPsst for account inbox routing. Receivers
MUST require the requester client `p` tag and MAY accept a response without the
identity `p` tag.

### Authorization code

The comparison code is the first eight hexadecimal characters of the requester
client public key, rendered uppercase as `XXXX XXXX`. A responder SHOULD require
out-of-band authorization before disclosing the encryption private key.

NIP-4E does not prescribe the lifetime of requester or responder client keys.
A client may reuse a device key or generate a key for one exchange without
changing the event format.
