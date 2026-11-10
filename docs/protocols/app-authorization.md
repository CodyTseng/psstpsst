# Application authorization

Application permissions are account/source-scoped. First-use choices initialize
ordinary rules or enable full trust; they are not persistent authorization levels.
The policy is implemented in `src/services/app-authorization/`.

## First-use initialization

The host obtains explicit consent before launching a napplet, napp or nsite,
including nested launches. Ordinary websites open without application consent;
the first NIP-07 operation or WebLN `getInfo()` initializes permissions for the
host-verified main-frame origin. WebLN `enable()` does not request consent.
Everyday use is initially selected, but nothing is saved until Continue.
Closing the chooser cancels only the current request.

| Initial choice | Saved configuration |
| --- | --- |
| Manual | Initialized, full trust off, no generated rules |
| Everyday use | Initialized, full trust off, ordinary permanent allow rules below |
| Fully trust | Initialized, full trust on, no generated rules |

An authorization row's existence records completed initialization, including Manual
with no rules. No selected preset is stored. Initialization commits consent and
preset grants in one transaction, checks account/source lifetime, and never
reinitializes an existing configuration. Reset is required to choose again.
Existing explicit decisions are preserved when initializing an undecided source.

Everyday use creates these ordinary, editable grants once:

- Public-key disclosure and general NIP-04/NIP-44 encryption.
- Event signing for kinds `1, 4, 6, 7, 13, 16, 1059`.
- Host-mediated relay authentication.
- Wallet display name and supported-operation metadata, excluding balances/history.
- Basic application access: shell, network/resource, isolated storage, settings,
  appearance, UI, identity, common, public relay and outbox APIs.

Declaration checks still restrict application access. Granting a declaration does
not authorize mutations: signing and host actions retain their own rules.
Everyday use does not infer authority from names, gestures, kind ranges or record
identifiers. It does not grant decryption, HTTP authentication, upload actions,
profile/follow-list changes, deletion requests or other event kinds. Those requests
use explicit rules or review. Future preset changes never rewrite existing grants.
A generated grant edited to Ask or Reject immediately follows that decision.
Removing or expiring a generated rule does not regenerate it.

## Full trust

Full trust is an independent, persistent boolean, editable in application
permissions after initialization. It automatically allows the known signer
methods, every valid event kind (including unknown kinds), host relay/HTTP
authentication, host uploads, wallet information and supported basic declared
access, including the upload capability. New host methods require an explicit
policy entry. Unknown or undeclared application APIs are never granted.

Saved signer and wallet-information decisions, including refusals, are paused
while full trust is on. They remain visible and are read-only. Disabling trust
restores them; operations without a saved decision ask. Disabling initially
selected full trust therefore does not generate Everyday use grants.
Independent browser/device permissions remain editable and effective.

Enabling trust explicitly explains that individual refusals will be paused.
Both toggle directions require confirmation explaining that affected running
instances close to apply launch-bound access. The durable update commits before
cross-host invalidation/closure. Failed persistence retains the prior state.
Changing trust clears execution-local approvals but retains permanent and timed
rules with their original expiry; turning trust off cannot revive a session grant.

## Request evaluation

1. Validate account, source, document lifetime, request structure and applicable
   declarations. Full trust cannot bypass these checks.
2. Use independent browser/device/payment/invoice reviews where applicable.
3. Initialize permissions if no consent row exists.
4. If full trust covers the operation, allow it.
5. Otherwise consult the active exact-scope rule. Execution-local decisions precede
   persisted decisions. Allow proceeds, Reject fails, and Ask opens review.
6. Without a rule, request approval. Cancellation saves no rejection.

One-request decisions do not change stored rules. Session decisions last for the
current controller and are cleared on trust changes. Timed/permanent remembered
decisions replace the existing exact-scope rule; expired rules are ignored even
before cleanup. Expiry falls back to review, not to the initial preset.
Permanent Ask is an explicit rule without a duration selector. Editing a matching
rule invalidates its previous session decision; unrelated edits preserve it.
Decisions commit before signer execution; signer latency does not expire them.

Every queued request checks current authority. Authority revisions guard prompts,
persistence and result disclosure across windows. Reset or trust/rule changes
invalidate obsolete approvals and withhold results still being computed. Completed
side effects are never automatically retried. Shared account/source queues serialize
reviews through dismissal and commit before processing the next request.

## Scope and access lifetime

Sources are canonical application event keys or host-verified HTTP(S) main-frame
origins (scheme, host, effective port), never caller-provided names or origins.
Rules are isolated by account/source. Signed application updates retain them;
unsigned local replacements atomically clear consent/trust and previous grants.
Old documents cannot persist decisions for replacement versions.

Event rules use operation + kind + optional `scope_key`. Addressable events use
the actual d-tag; another record needs its own decision. Public-key and crypto
rules use separate method scopes, independently of the cryptographic peer.
Host authentication/upload rules use action scopes, independently of destination
URLs and methods. Publication remains ordinary signing even for authentication
or upload-related kinds. General encryption/decryption and gift-wrap signatures
cannot guarantee that encrypted contents represent harmless chat operations.

Declared access is restricted to the verified application's supported declarations.
Existing optional storage/settings/appearance defaults apply only when not denied.
Explicit capability edits update only their own grants/denials atomically; they
never rewrite unrelated decisions from an effective-access snapshot. Running
applications pin launch access. Capability edits restart affected containers;
trust changes close them across hosts. Already received data cannot be recalled.
Internal shell access is implicit and does not trigger consent.

Reset removes initialized consent, full trust, signer rules, capability grants and
browser decisions before closing the source. The next application launch, or a
website's next account/wallet-information request, initializes again. Reset does
not claim to revoke operating-system permissions or undo completed operations.

## Independent boundaries

At every configuration, camera/microphone/location/notifications/clipboard reads
retain browser/device and OS reviews. Capture selectors and unknown resources
require fresh review. Ordinary clipboard writes and public reads keep their
existing behavior. Host wallet payments require per-payment confirmation and
authentication; invoice creation requires its own review. Full trust never replaces
these reviews or allows account-key export/message-key transfer.
Signed or encrypted data can authorize actions at external services; per-payment
guarantees describe the host wallet API rather than arbitrary external effects.

## Migration

Migration materializes legacy Everyday use allowances as ordinary editable rules
and replaces its previously ignored covered decisions with those effective allows.
Unrelated decisions remain unchanged. Legacy Manual becomes initialized with trust
off; legacy Trusted becomes initialized with trust on, retaining paused rules.
Declared-access values and usage counters migrate together. No legacy level is
retained, and migration never grants a broader operation set than the old policy.
