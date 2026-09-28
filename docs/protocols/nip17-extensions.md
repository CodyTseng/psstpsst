PsstPsst NIP-17 Extensions
==========================

`draft` `optional`

This document describes the event fields PsstPsst adds to
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md). It is not a
published NIP.

| Event | Extension | Purpose |
| --- | --- | --- |
| kind `10044` | `n` tag | Announce a messaging encryption public key |
| kind `4454` | client key and relay tags | Request the key on another device |
| kind `4455` | encrypted key and client-address tags | Transfer the key to that device |
| kind `13` seal | `n` tag | Identify the sender's messaging encryption key |
| kind `1059` gift wrap | identity-key `p` tag | Route a split-key recipient's envelope |
| message rumor | `ms` tag | Add millisecond ordering within `created_at` |
| group rumor | `h` tag | Keep one stable group identity across membership changes |
| group rumor | `action` tag | Express group creation, membership changes, and renaming |

Kind `14` chat messages, kind `15` file messages, kind `7` reactions, kind `13`
seals, kind `1059` gift wraps, and kind `10050` relay lists otherwise retain
their NIP-17 meanings.

## Messaging encryption key

PsstPsst separates the identity key from the key used for NIP-44 messaging
encryption. This follows the direction of the
[NIP-4E proposal](https://github.com/nostr-protocol/nips/pull/1647).

The identity publishes its current encryption public key in a replaceable kind
`10044` event:

```json
{
  "kind": 10044,
  "pubkey": "<identity-pubkey>",
  "tags": [["n", "<encryption-pubkey>"]],
  "content": ""
}
```

The identity key signs both this announcement and outgoing kind `13` seals. A
seal carries the sender's encryption public key in the same tag:

```text
["n", "<sender-encryption-pubkey>"]
```

Its content is encrypted with the sender's encryption private key and the
recipient's encryption public key. The seal's `created_at` equals the rumor's
`created_at`.

A kind `1059` gift wrap is encrypted to the recipient's encryption key but is
addressed by the recipient's identity key:

```text
["p", "<recipient-identity-pubkey>"]
```

### Gift-wrap template

```js
{
  "id": "<gift-wrap-id>",
  "pubkey": "<one-time-ephemeral-pubkey>",
  "created_at": "<random-time-within-the-previous-two-days>",
  "kind": 1059,
  "tags": [
    ["p", "<recipient-identity-pubkey>"]
  ],
  "content": nip44_encrypt(
    JSON.stringify({
      "id": "<seal-id>",
      "pubkey": "<sender-identity-pubkey>",
      "created_at": "<rumor-created-at>",
      "kind": 13,
      "tags": [["n", "<sender-encryption-pubkey>"]],
      "content": nip44_encrypt(
        JSON.stringify(unsigned_message_rumor),
        conversation_key(
          "<sender-encryption-private-key>",
          "<recipient-encryption-pubkey>"
        )
      ),
      "sig": "<sender-identity-signature>"
    }),
    conversation_key(
      "<one-time-ephemeral-private-key>",
      "<recipient-encryption-pubkey>"
    )
  ),
  "sig": "<one-time-ephemeral-signature>"
}
```

One such gift wrap is created for every recipient and for the sender.

## Encryption-key synchronization

Kinds `4454` and `4455` transfer the current messaging encryption private key
between devices already using the same identity.

A requesting device generates a one-time client key pair and publishes a kind
`4454` event signed by the identity key:

```text
["pubkey", "<requester-client-pubkey>"]
["P", "<requester-client-pubkey>"]
["relay", "<transfer-relay>"]
["n", "<requested-encryption-pubkey>"]  // optional
```

Another device publishes a kind `4455` response signed by the same identity.
Its content is the requested encryption private key encrypted with NIP-44 to
the requester's client key:

```text
["P", "<one-time-sender-client-pubkey>"]
["p", "<identity-pubkey>"]
["p", "<requester-client-pubkey>"]
```

The requester uses the `P` key to decrypt the response. The transferred private
key is valid only when its derived public key matches the current kind `10044`
`n` value. This prevents an older transfer from replacing the currently
announced encryption key.

## Millisecond ordering

Private message rumors may carry the millisecond component of their creation
time:

```text
["ms", "<0..999>"]
```

The full timestamp is `created_at * 1000 + ms`. This tag is encrypted with the
rumor and is not used for relay queries or gift-wrap timestamps.

## Stable group identity

NIP-17 identifies a room by the rumor author and its `p` tags, so changing the
participant set creates another room. PsstPsst adds an opaque stable identifier:

```text
["h", "<group-id>"]
```

The same `h` value identifies the same group across membership changes. A group
ID is a UTF-8 value from 1 to 256 bytes. PsstPsst-generated values are 32 random
bytes encoded as 64 lowercase hexadecimal characters; they are identifiers,
not public keys.

Group kind `14` and kind `15` rumors and wrapped kind `7` reactions carry this
tag.

## Group actions

Group state changes are represented by the first `action` tag in a rumor:

```text
["action", "create"]
["action", "invite", "<target-pubkey>"]
["action", "remove", "<target-pubkey>"]
["action", "rename"]
```

An action target is a 64-character lowercase hexadecimal public key.

### Create

`create` marks the first kind `14` or kind `15` message in a group. The event
remains an ordinary text or file message. Its `p` tags list the initial members
other than the author.

### Invite

`invite` is an empty kind `14` message. Its target is the new member. Its `p`
tags carry the current members other than the author and include the target,
allowing the same event to describe the group to the invitee.

### Remove and leave

`remove` is an empty kind `14` message. Its target is the removed member. The
target remains in `p` when another member removes them so that the target can
receive the event.

An author removes itself to express leaving the group; there is no separate
`leave` action.

### Rename

`rename` is an empty kind `14` message carrying a `subject` tag. A non-empty
trimmed value sets the group name. An empty or value-less subject clears it.
PsstPsst group names contain at most 80 Unicode code points.

An invite may also carry the current `subject` so that the invitee receives the
group name together with the member list.

## Compatibility

The split-key envelope requires support for kind `10044` and the seal's `n`
tag. Clients that understand the envelope but ignore `h` and `action` can still
read ordinary message content, but may split a stable group when its `p` tags
change and may display empty action messages.
