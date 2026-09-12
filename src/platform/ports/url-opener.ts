/**
 * Port for handing a URL to the OS (the browser or the owning app) — used by
 * the NIP-46 signer flows (`services/signer/`) to surface `auth_url` approval
 * pages.
 *
 * Best-effort by contract: opening an external URL is fire-and-forget UX, so
 * implementations never reject.
 */
export interface UrlOpenerPort {
  /** Open a URL in the system handler. Never rejects. */
  openExternalUrl(url: string): Promise<void>;
}
