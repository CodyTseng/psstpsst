PsstPsst NIP-17 Extensions
==========================

`draft` `optional`

This document defines how PsstPsst uses
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) with separate
encryption keys, millisecond timestamps, and stable group conversations. Key
announcement and synchronization are specified separately in the
[NIP-4E profile](./nip4e.md).

| Event | Extension | Purpose |
| --- | --- | --- |
| kind `13` seal | `n` tag | Identify the sender's encryption key |
| kind `1059` gift wrap | identity-key `p` tag | Route a split-key envelope |
| message rumor | `ms` tag | Add the millisecond component of creation time |
| group rumor | `h` tag | Keep one group identity across membership changes |
| group rumor | `action` tag | Express creation, membership changes, and renaming |

Kind `14` chat messages, kind `15` file messages, kind `7` reactions, and their
NIP-17/NIP-59 envelopes otherwise retain their standard meanings.

## Split-key envelope

The identity key signs the kind `13` seal. The seal's first `n` tag identifies
the sender's encryption public key announced through NIP-4E:

```text
["n", "<sender-encryption-pubkey>"]
```

The seal content is NIP-44-encrypted using the sender's encryption private key
and the recipient's encryption public key. The seal `created_at` equals the
rumor `created_at`.

The kind `1059` gift wrap is NIP-44-encrypted to the recipient's encryption
public key but routed with the recipient's identity public key:

```text
["p", "<recipient-identity-pubkey>"]
```

The complete envelope is:

```js
{
  "id": "<gift-wrap-id>",
  "pubkey": "<one-time-ephemeral-pubkey>",
  "created_at": "<random-time-within-the-previous-two-days>",
  "kind": 1059,
  "tags": [["p", "<recipient-identity-pubkey>"]],
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

One gift wrap is created for each recipient and for the sender. Relay routing
continues to use the identity pubkey and kind `10050`; only NIP-44 key agreement
uses the encryption key.

### Receiving

A receiver:

1. Verifies the kind `1059` gift wrap and decrypts it with the recipient's
   encryption private key and the wrapper's ephemeral public key.
2. Verifies the enclosed kind `13` seal with the sender's identity public key.
3. Reads the sender's encryption public key from the seal's first `n` tag and
   decrypts the rumor with that key and the recipient's encryption private key.
4. Verifies the rumor ID and requires the rumor `pubkey` to equal the seal
   `pubkey`.

After verification, the receiver submits the seal's encryption public key as
device-wide key evidence for the sender identity. Seal evidence uses the
authenticated rumor order (`created_at`, optional `ms`, then event ID); kind
`10044` evidence uses its signed `created_at` and event ID. The two sources
share one latest-evidence row, so a newer message or announcement replaces an
older key while delayed history cannot roll the key back.

A relay-delivered seal without a valid `n` tag is not a PsstPsst split-key
envelope.

## `ms` tag

Nostr `created_at` has one-second precision, but a user may create several
messages within the same second. Common examples include sending multiple
images at once and forwarding multiple messages as one action. Relay arrival
order is not stable, so `created_at` alone cannot preserve their authored
order. The `ms` tag exposes the missing sub-second component so clients can
distinguish messages created within the same second.

Private message rumors may carry the millisecond component of their creation
time:

```text
["ms", "<0..999>"]
```

Only the first `ms` tag is used. A missing or malformed value contributes zero
milliseconds. The full timestamp is:

```text
created_at * 1000 + ms
```

The tag is encrypted with the rumor and is not used for relay queries or
envelope timestamps. Clients may reconstruct the millisecond timestamp from
`created_at` and `ms`; how they sort or present messages is outside this
specification.

## Stable group identity

NIP-17 normally identifies a room by the rumor author and its `p` tags, so a
membership change creates another room. PsstPsst adds an opaque stable ID:

```text
["h", "<group-id>"]
```

Only the first `h` tag is used. Its value is 1–256 UTF-8 bytes. Senders SHOULD
generate 32 random bytes and encode them as 64 lowercase hexadecimal
characters. A group ID is an identifier, not a public key.

Group kind `14` and kind `15` rumors and wrapped kind `7` reactions carry the
same `h` value. Groups do not introduce a shared encryption key. Each rumor is
sealed and gift-wrapped separately for every addressed member and for the
sender. Its `p` tags remain the delivery audience for that rumor.

## Group actions

The first `action` tag describes a group state change:

```text
["action", "create"]
["action", "invite", "<target-pubkey>"]
["action", "remove", "<target-pubkey>"]
["action", "rename"]
```

Targets are 64-character lowercase hexadecimal public keys. A malformed first
`action` tag invalidates the rumor; later `action` tags are ignored.

A complete invite rumor, before sealing and gift wrapping, has this form:

```json
{
  "id": "<rumor-id>",
  "pubkey": "<author-identity-pubkey>",
  "created_at": "<unix-timestamp>",
  "kind": 14,
  "tags": [
    ["p", "<current-member-pubkey>"],
    ["p", "<invited-member-pubkey>"],
    ["h", "<group-id>"],
    ["ms", "<0..999>"],
    ["action", "invite", "<invited-member-pubkey>"],
    ["subject", "<current-group-name>"]
  ],
  "content": ""
}
```

The rumor is unsigned; its kind `13` seal supplies the identity signature. The
`subject` tag is optional.

### Create

`create` marks the first kind `14` or kind `15` rumor in a group. Its `p` tags
list the initial members other than the author. A kind `14` create has non-empty
content; a kind `15` create contains a valid file offer. The rumor keeps its
ordinary text or file presentation.

### Invite

`invite` is an empty kind `14` rumor. Its target is the new member. Its `p` tags
contain the current members other than the author and MUST include the target.
This lets the target initialize the group without earlier history.

### Remove and leave

`remove` is an empty kind `14` rumor. When removing another member, the target
MUST remain in `p` so it can receive the removal. When the target equals the
author, the action means leave and the target need not appear in `p`.

### Rename

`rename` is an empty kind `14` rumor with a `subject` tag. A non-empty trimmed
value sets the group name. A missing, empty, or whitespace-only value clears it.
Names contain at most 80 Unicode code points.

An invite MAY include the current `subject` so the new member receives the name
with the roster.

## Group state

An unknown group is initialized only by `create` or `invite`. Its initial roster
is the author plus the valid `p` values. After initialization, ordinary-message
`p` tags describe only that rumor's audience and MUST NOT replace the roster.

Membership actions are applied in rumor order. Their author MUST be a member at
that point in the action history. `invite` adds its target and `remove` removes
its target. A later `invite` may add a removed member again. Any current member
may publish an action; there is no administrator or membership quorum.

Only the first `subject` tag is used. On any accepted kind `14` or kind `15`
group rumor, absence preserves the name, a missing or empty value clears it, and
other values are trimmed. The newest accepted subject under the event order
wins independently of membership replay. An overlong subject is ignored on an
ordinary message, `create`, or `invite`; it invalidates a `rename` action.

This extension does not deliver earlier rumors to a newly invited member.

## Compatibility

Clients that ignore `h` and `action` can still decrypt ordinary NIP-17 content,
but may split one stable group into multiple rooms when its `p` tags change and
may display empty action rumors as messages.
