# Application comments

Application details expose public plaintext NIP-22 comments (`kind:1111`), not
numeric ratings or private chat messages. Website scopes follow NIP-73.

## Root and parent references

- Replaceable/addressable Napplets, napps and nsites use uppercase `A` with the
  canonical `kind:pubkey:identifier` coordinate, `K` with the manifest kind and
  `P` with its publisher. Regular replaceable events have an empty identifier.
  Upgrading a manifest retains the same root discussion.
- Immutable legacy kind-5129 listings use `E` with the event ID, `K` and `P`.
- Websites use `I` with their canonical full URL and `K=web`. No publisher is
  invented for external URL scopes.
- Top-level comments repeat the root reference in lowercase, with `k` and the
  parent author's `p` when available. Addressable parents also include `e` for
  the exact manifest version displayed when the review was posted.
- Replies retain the root tags and use `e` for the selected comment ID,
  `k=1111` and `p` for that comment's author. Event-ID references include author
  hints. Loaded parents are checked against those author tags.

Incoming events are copied before signature verification and must match the
exact root, root kind and root author. Bodies are nonempty plaintext of at most
4,000 UTF-16 code units. HTML/Markdown syntax is displayed literally. Unsupported
or malformed parent references, oversized metadata, forged signatures and
events more than ten minutes in the future are ignored.

## Transport and lifetime

Discussions use isolated account-bound relay pools. Reads, live subscriptions and
publication share the deduplicated union of the publisher's NIP-65 read relays
and the general metadata-discovery relays plus `wss://relay.napplet.soy/`.
These discussion routes are independent of the dedicated application catalogue
sources, which may reject comment events. Unmarked NIP-65 relay entries also count as
read relays; write-only entries do not. Websites without a publisher and
publishers without configured read relays use the discovery set alone. Reads and
subscriptions use a root-tag filter and kind 1111.
Reads request 100 events per page and use inclusive `until` cursors, widening
duplicate-only timestamp-boundary pages up to 500 events. The visible model is
bounded to the newest 500 comments. Roots are newest first; replies within each
thread are chronological. Missing parents remain visible and are attached when
subsequent pages supply them. Visible indentation is capped at three levels.

Live arrivals are deduplicated and verified in small batches, yielding between
chunks. Ordering is updated incrementally; input state never belongs to the
thread's store. The queue holds at most 128 pending events. Screen blur destroys
the pools and cancels in-flight operations; focus creates a fresh transport
around the retained bounded read model. Locking, switching or removing accounts
also stops matching sessions.

Posting is an explicit host action, separate from an application's grants. The
composer names the public posting account. Account availability and session
lifetime are checked before signing and publishing. The resolved relay set is
shared for the screen's focused lifetime. The current account's identity
signer signs the exact NIP-22 template; messaging keys are never used.

At least one successful relay acknowledgement is required before clearing the
draft. A failed submission retains its signed event for an identical retry,
avoiding duplicate reviews after uncertain delivery. Read results and comments
do not populate private messaging tables or the local public-event database.

References: [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md),
[NIP-73](https://github.com/nostr-protocol/nips/blob/master/73.md).
