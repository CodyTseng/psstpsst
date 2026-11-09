# App authorization levels and permissions

This policy applies to napplets, napps, nsites and HTTPS websites through the
shared account/source policy. It covers declared basic application access and
signer methods and wallet metadata while preserving browser, device, payment and
invoice reviews. The
implementation is `src/services/app-authorization/policy.ts`.

## App Authorization Level

The shared policy is called **App Authorization Level** (`AppAuthorizationLevel`
in code). It controls application access, NIP-07 account authority and WebLN wallet
information reads; payment, invoice and device consent remain independent. Its values are `manual`, `routine` and `trusted`.

On the first open of a napplet, napp or nsite for an account and verified source,
the host asks for a level before launch-access reviews or execution, even if the
app never requests account methods. This includes nested inline launches. Routine is initially selected, but no authority is granted until the
user continues. Closing the sheet rejects only the current request and saves
nothing. Selecting a level does not approve a request outside that level's automatic
scope: the ordinary operation review follows after the level sheet closes.
Existing applications without a level also receive this choice on their next
open; their explicit rules are preserved without an automatic upgrade.

Ordinary websites open without level selection or application-access review. The
host injects only NIP-07 and WebLN providers, without `napp` or `nostrdb` access.
The first NIP-07 call or WebLN `getInfo()` obtains a level if needed for the account
and current host-verified HTTPS main-frame origin; navigation to another origin
does not inherit it. WebLN `enable()` initializes the document without prompting.
Routine and Trusted automatically allow wallet display names and supported-operation
metadata; balances and transaction history are not exposed. In Manual, `getInfo()`
uses account/source-scoped single-request, timed or permanent Allow/Reject decisions,
editable and revocable in application permissions. Level coverage precedes these
rules without deleting them; returning to Manual restores their effect. Payments
and invoice creation always require their own reviews without information consent.

| Operation | Manual | Routine | Trusted |
| --- | --- | --- | --- |
| Declared network/resource access, app-isolated storage, settings, appearance and UI | Ask | Allow | Allow |
| Declared public-relay and outbox API access (mutations still use signer policy) | Ask | Allow | Allow |
| Declared public-upload capability | Ask | Ask | Allow |
| Other declared capabilities, including app-to-app messaging and development access | Ask | Ask | Ask |
| Disclose the current account's public key | Ask | Allow | Allow |
| Read wallet display name and supported operations | Ask | Allow | Allow |
| Host-mediated relay authentication | Ask | Allow | Allow |
| Host-mediated HTTP authentication | Ask | Ask | Allow |
| Sign notes/replies (`1`), reposts (`6`, `16`), reactions (`7`) | Ask | Allow | Allow |
| General NIP-04 / NIP-44 encryption | Ask | Allow | Allow |
| General NIP-04 / NIP-44 decryption | Ask | Ask | Allow |
| Sign encrypted messages (`4`), seals (`13`), gift wraps (`1059`) | Ask | Allow | Allow |
| Sign profiles, follow lists, relay/inbox settings, private lists | Ask | Ask | Allow |
| Sign deletion requests (`5`) | Ask | Ask | Allow |
| Sign application data, addressable records and other known event kinds | Ask | Ask | Allow |
| Sign unrecognized valid event kinds | Ask | Ask | Allow |
| Host-mediated public-file upload | Ask | Ask | Allow |

Ask supports one-request, timed and permanent Allow/Reject decisions. Levels do
not expire; timed exceptions fall back to the selected level when they expire.
Session exceptions last only for the current controller. Switching levels retains
explicit decisions, including session exceptions. Reset removes the level and
signer exceptions; the next application open, or the next NIP-07 call or WebLN `getInfo()` from a
website, asks for a level again.

Routine has a fixed kind allowlist: `1, 4, 6, 7, 13, 16, 1059`. It does not infer
safety from kind ranges, application declarations, names, record prefixes or claimed
user gestures. Other kinds require review. Trusted permits every valid event kind,
including previously unknown ones, but new host methods need an explicit policy
entry. Structural validation, account availability and source/lifetime checks apply
at every level, including Trusted.

Encryption and decryption are general cryptographic capabilities, not private-message
permissions. Their grants distinguish method and algorithm but apply across peers.
The host cannot identify the purpose of arbitrary plaintext or ciphertext. Likewise,
seals and gift wraps can contain arbitrary events; allowing them does not guarantee
that the hidden contents are harmless chat messages. NIP-17 rumors are unsigned;
Routine does not automatically sign plaintext rumor kinds `14` or `15`.

HTTP authentication authorizes a specific URL and method, potentially a mutation,
not merely login. Routine therefore asks. Remembering that operation still grants
all destinations and methods, as with existing app-action rules.

## Scope and precedence

The verified source is a canonical application event key or the current HTTPS
main-frame origin (scheme, host and effective port). An app name, caller-supplied
origin, redirect or embedded subframe cannot choose it. Preferences and exceptions
are isolated by account and source; ordinary signed-application updates retain them. Replacing an unsigned local
application atomically resets its level and exceptions with the existing installer
permission reset; old documents cannot write preferences for the new version.

At application launch (excluding ordinary websites) and for every validated
account request:

1. Obtain an explicit level if none has been saved. Account methods retain this
   fallback for navigation to another verified origin.
2. If the level automatically allows the operation, allow it without consulting single-operation rules.
3. Otherwise apply an active exact-scope decision: session decisions take precedence
   over persisted Allow, Reject or Ask every time rules.
4. Without an applicable decision, or with Ask every time, show the ordinary review.

Level-covered operations have no single-operation editing controls, including in
recent activity. Existing rules remain stored but are ignored while covered; they
become effective again after lowering the level, provided they are still valid.
Management omits level-covered signing rules instead of repeating automatic
allowances. Stored rules reappear when the level no longer covers them.

For operations outside the level, Ask every time is persisted. A one-request
decision leaves that rule intact; a session grant temporarily overrides it, and a
remembered Allow or Reject replaces it. Unrelated changes preserve session grants.
Permanent Ask rules have no duration selector.

Event exceptions use account + source + operation + kind + `scope_key`. Addressable
events derive the exact qualifier from their actual d-tag; another record needs a
separate decision. A record identifier does not prove application ownership.
Public-key and crypto exceptions use their method scopes. Host authentication and
upload exceptions use their action scopes without destination qualifiers. Publication never becomes a host action based on the event kind. Direct signer
authentication requests retain their existing validated action classification.

A level is one row in `app_authorization_preferences`, not a generated collection of grants.
Policy checks are constant-time and independent of message-history size. Existing
bounded metadata-only activity records include automatic level decisions; plaintext,
ciphertext and signed payloads are not permission history. Level changes use the
same cross-host invalidation and revision guards as exception changes. Queued
requests recheck policy; results authorized under an obsolete revision are withheld.

## Access lifetime

Automatic access is derived from the current level and the verified application's
supported declarations. It never becomes a generated persistent domain grant or
expands a sealed application's network policy. Existing grants/denials remain
stored for use outside level coverage; covered optional capabilities are read-only
in management. Existing no-prompt optional defaults remain unchanged when not
explicitly denied. Capability edits carry only explicit per-capability changes and atomically update
those saved decisions. Effective access is never submitted as a replacement grant
list. Unrelated stored grants/denials and the level remain untouched, including
denials temporarily covered by a level. Unknown capabilities and undeclared APIs
are never granted by a level. App storage means only the app's isolated namespace, not private host data.

Launch access belongs to the running document/session. Changing a level updates
signer decisions immediately and changes derived access on the next launch; it
cannot retract network data already received by a running webpage. Reset closes
the source after removing persistence. Applications reselect a level and check
access on reopening; ordinary websites defer selection until their next NIP-07 call or WebLN `getInfo()`. Native browser/OS reviews remain independent at every level.

## Independent boundaries

| Capability | Behavior at every app authorization level |
| --- | --- |
| Public-event/metadata reads, existing no-prompt clipboard writes | Existing behavior; ordinary websites have no local-database API |
| Level-covered declared application access | Automatically available in Routine/Trusted; stored grants apply in Manual |
| Other declared application access | Existing launch and optional-capability reviews |
| Camera, microphone, location, notifications, clipboard reads | Separate browser/device and OS authorization |
| Screen capture and unknown browser capabilities | Fresh review under existing browser rules |
| New windows, external applications, downloads and file saves | Existing host reviews and destination pickers |
| WebLN invoice creation | Separate review for every request |
| Host wallet payments | Per-payment confirmation and authentication; never remembered |
| Account-key export and outgoing message-key transfer | Dedicated trusted host confirmation |

Signing a public key, encrypted payload or event can also authorize actions at an
external service. The host cannot guarantee that arbitrary signed/encrypted content
will never trigger an external payment or deletion. Per-payment guarantees apply to
the host wallet API. Trusted explicitly delegates broad account authority and is
never the initially selected level.

## Protocol references

- [NIP-98 HTTP authentication](https://github.com/nostr-protocol/nips/blob/master/98.md)
- [NIP-17 private messages](https://github.com/nostr-protocol/nips/blob/master/17.md)
- [NIP-59 gift wrapping](https://github.com/nostr-protocol/nips/blob/master/59.md)
