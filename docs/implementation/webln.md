# WebLN in Explore

Explore websites, napps and nsites receive a main-frame-only `window.webln`
provider at document start. Ordinary websites require HTTPS. The sealed napplet
runtime does not expose this API. Transport origin and document authority remain
host-owned, using the same lifecycle boundary as the existing NIP-07 bridge.

## Supported interface

- `enable()` initializes the current document after checking that a connected
  wallet exists, without asking for consent. Repeated calls reuse initialization.
  Opening a website does not prompt.
- `isEnabled()` reports that document's initialization, independently of wallet
  information consent. Each operation checks wallet availability; each payment
  and invoice review offers only eligible wallets.
- `getInfo()` returns the default wallet's display name and the union of methods
  supported by the account's connected wallets; it does not expose balances or
  transaction history. The first call obtains an App Authorization Level if the
  account and verified source have none. Routine and Trusted allow these reads
  automatically, before consulting individual rules. Manual uses a wallet
  information review that identifies the verified source and describes
  the disclosed information; it does not select a payer. The shared duration
  selector offers one request, 10 minutes, 1 hour, 24 hours or permanent access,
  equally for Allow and Reject. One-request decisions apply only to the current
  call. Timed and permanent decisions persist by account and verified website
  origin or application ID, survive navigation and restart, and remain editable
  or revocable in application permissions. Each call rechecks the indexed
  level, and in Manual the `webln-info` rule in the shared capability-permission
  store. Covered rules are preserved for later downgrades; no document-local
  allow cache can outlive a saved change. Expired rules prompt again. Source
  authorization queues recheck committed decisions before reviewing another call.
  Local application versions remain read/write preconditions rather than grant
  identities. Denial does not disable initialization or prevent separately
  reviewed payments and invoices. Wallet availability, document lifetime,
  permission revision and grant expiry are rechecked before returning information.
  `node.pubkey` is empty: an NWC service public key is not a Lightning node key.
  The provider does not support node-identity authentication.
- `sendPayment(bolt11)` accepts a checksum- and signature-verified BOLT11 invoice
  with a positive, fixed amount representable exactly in millisatoshis. It
  rejects amountless, expired, malformed and oversized invoices. It returns
  `{ preimage }` only after verifying SHA-256(preimage) against the payment hash.
- `makeInvoice(args)` accepts `amount`, `defaultAmount`, `minimumAmount`,
  `maximumAmount`, and `defaultMemo`. Invoice creation uses positive whole sats
  and checks safe conversion to millisatoshis. Without a fixed amount, the host
  lets the user choose within the requested range. It checks the returned
  signed invoice's amount before exposing `{ paymentRequest }`.

Additional methods, including keysend, node signing and automatic payment
budgets, are unsupported. The wallet's own node verifies network and supported
invoice features. Invoice text is untrusted content, never host identity.

## Payment authority and replay protection

Every debit has a fresh host review displaying the verified source, selected
wallet, signed amount and bounded description. Payment and invoice reviews
reuse the existing wallet confirmation and wallet picker sheets, with the
requesting source added. The default eligible wallet is preselected, and the
user may change it before confirming. A structured host decision binds the
reviewed wallet ID, constrained amount and any PIN token. The service refuses
wallet IDs outside the reviewed set and rechecks the selected wallet before
sending. Confirmation closes completely before the original PIN sheet or
system authentication and wallet transport proceed. PIN verification happens in
the host and yields a short-lived, single-use authorization; neither PIN nor
credential ever reaches the page. If authentication is not configured, payment
fails closed and the user must configure it through wallet settings.

The queue checks document lifetime, source permission revision, review deadline,
invoice expiry and wallet availability before sending. It rechecks authority
again after asynchronous signing and durable preparation. A busy document
rejects additional wallet operations instead of accumulating payment prompts.
Wallet and database errors are reduced to fixed public error codes.

The `webln_payments` table has an account/payment-hash primary key and no wallet
foreign key. Its asynchronous write transaction checks account availability and
claims the hash before any debit publication. The primary key arbitrates
concurrent documents and desktop processes. The claim survives process restart,
wallet removal, permission reset and application-data deletion. Account removal
cascades it like other account-owned data. No message history is scanned.

Claims are deliberately conservative: even an explicit wallet error, a crash
between claiming and publishing, or a document closing during final preparation
blocks another WebLN attempt for that hash. Uncertain outcomes require checking
the wallet; the provider never releases a claim or retries payment automatically.
Replay protection covers WebLN requests in this installation and account, not
manual payments or independent installations. The wallet remains responsible
for Lightning payment-hash idempotency across clients.

Pending and completed transactions are cached in the existing wallet history.
A completed debit is accounted for even if the requesting page has closed;
results are never delivered to a replacement document. Database or history
persistence failures prevent a success response. Secrets, invoices, preimages
and wallet-supplied errors are excluded from WebLN bridge diagnostics.

## Validation

Automated coverage includes signed invoice parsing, malformed amounts and tags,
expired invoices, permission revocation, navigation during authentication,
concurrent operations, wallet removal, durable claim conflicts, invalid payment
proofs, amount constraints and accounting after document closure. Live wallet
and device checks must cover Android, iOS and Electron before release, including
system authentication, PIN entry, pending payments and foreground task changes.
