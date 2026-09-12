# Notification recovery

Periodic notification recovery scans gift wraps for the account in the inclusive
window `[poll cutoff - 49 hours, poll cutoff]`. The cutoff stays fixed throughout
the run. This accommodates randomized envelope timestamps; it is not a durable
arrival cursor. Older messages wait for foreground history recovery.

After refreshing routing and encryption-key metadata, the poll visits each DM
relay with `since`, `until`, and `limit: 200`. Each relay keeps its own `until`;
rounds alternate between relays. Events are processed and stored before moving
the boundary. Processed gift-wrap IDs skip repeated decryption and notification.
Only one page is retained by the pager at a time.

The next query includes the oldest returned timestamp again. Even a short page
needs another query: a relay may impose a smaller result limit. Empty wire-EOSE
responses finish a relay. Deadlines, CLOSED, and connection failures cannot
confirm a page, although messages already received are still stored. Other
relays can continue when one fails.

When a page contains only events at the current boundary second and fills the
requested limit, the poll doubles that limit, up to 3,200. A still-saturated
second interrupts that relay instead of decrementing the timestamp and skipping
events. NIP-01 offers no secondary event-ID cursor: a relay that silently caps
results below the requested limit can still hide events sharing one timestamp.
This protocol cannot guarantee completeness against such a relay.

Polling does not read or write `forwardSince` or `backwardUntil`. Interruption
does not seal any history frontier; the next poll rechecks its recent window.
Consequently this is best-effort notification recovery, not guaranteed recovery
of an arbitrarily long offline gap. OS expiration, session replacement, or an
observed key change cancels ongoing work. Historical catch-up starts in the
foreground and may continue when the app subsequently backgrounds.
