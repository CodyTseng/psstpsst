/**
 * Port for handing a URL to the OS (the browser or the owning app) — used by
 * the NIP-46 signer flows (`services/signer/`) to surface `auth_url` approval
 * pages.
 *
 * Best-effort by contract: implementations never reject, but report whether
 * the operating system accepted the URL so action-local UI can show feedback.
 */
export interface UrlOpenerPort {
  /** Called only after the host has reviewed a webpage's explicit external-app request. */
  openApprovedBrowserUrl?(url: string): Promise<boolean>;
  /** Open a URL in the system handler. Resolves false instead of rejecting. */
  openExternalUrl(url: string): Promise<boolean>;
}
