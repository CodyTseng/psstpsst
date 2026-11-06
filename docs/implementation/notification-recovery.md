# Notification Recovery Implementation

Periodic notification recovery scans gift wraps for the account in the inclusive
window `[poll cutoff - 49 hours, poll cutoff]`. The cutoff stays fixed throughout
the run. This accommodates randomized envelope timestamps; it is not a durable
arrival cursor. Older messages wait for foreground history recovery.

After refreshing routing and encryption-key metadata, the poll visits each DM
relay with `since`, `until`, and `limit: 500`. Each relay keeps its own `until`;
rounds alternate between relays. Events are processed and stored before moving
the boundary. Processed gift-wrap IDs skip repeated decryption and notification.
Only one page is retained by the pager at a time.

The next query includes the oldest returned timestamp again. Even a short page
needs another query: a relay may impose a smaller result limit. Empty EOSE
responses finish a relay. Wire EOSE and the 25-second timeout fallback both
complete a page; timeout reasons remain available for diagnostics. CLOSED and
connection failures leave the page incomplete, although received messages are
still stored. Other relays can continue when one fails.

History and recovery share a fixed page limit of 500. Once a query is confined to the current
boundary second, it moves to the preceding second without raising that limit.
NIP-01 offers no secondary event-ID cursor, so events sharing a timestamp beyond
the relay's returned page may remain undiscovered. Boundary reads are best-effort.

Polling does not read or write `forwardSince` or `backwardUntil`. Interruption
does not seal any history frontier; the next poll rechecks its recent window.
Consequently this is best-effort notification recovery, not guaranteed recovery
of an arbitrarily long offline gap. OS expiration, session replacement, or an
observed key change cancels ongoing work. Historical catch-up starts in the
foreground and may continue when the app subsequently backgrounds.
